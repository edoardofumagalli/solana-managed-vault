use std::{env, str::FromStr};

use anyhow::{bail, Context, Result};
use managed_vault_backend::{
    config::AppConfig,
    indexer::event_logs::{decode_raw_events_from_logs, RawEventContext},
    repositories::raw_events::{count_raw_events, insert_raw_event},
    services,
};
use serde_json::Value;
use solana_client::{rpc_client::RpcClient, rpc_config::RpcTransactionConfig};
use solana_sdk::{commitment_config::CommitmentConfig, signature::Signature};
use solana_transaction_status_client_types::{
    option_serializer::OptionSerializer, UiTransactionEncoding,
};

#[derive(Debug, Default)]
struct Args {
    signature: Option<String>,
    rpc_url: Option<String>,
    cluster: Option<String>,
    program_id: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = parse_args(env::args().skip(1))?;
    let signature = args
        .signature
        .as_deref()
        .context("missing required argument --signature <transaction_signature>")?;

    let mut config = AppConfig::from_env()?;
    if let Some(rpc_url) = args.rpc_url {
        config.rpc_url = rpc_url;
    }
    if let Some(cluster) = args.cluster {
        config.cluster = cluster;
    }
    if let Some(program_id) = args.program_id {
        config.vault_program_id = program_id;
    }

    let rpc_client = services::rpc::create_rpc_client(&config);
    let db_pool = services::db::create_pool(&config).await?;

    let transaction = fetch_transaction(&rpc_client, signature)?;
    let meta = transaction
        .transaction
        .meta
        .as_ref()
        .context("transaction does not include metadata")?;
    let logs = match meta.log_messages.as_ref() {
        OptionSerializer::Some(logs) => logs,
        OptionSerializer::None | OptionSerializer::Skip => {
            bail!("transaction does not include logs")
        }
    };
    let transaction_error = meta
        .err
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .context("serialize transaction error")?;
    let parsed_at = chrono::Utc::now().to_rfc3339();
    let context = RawEventContext {
        cluster: config.cluster.clone(),
        signature: signature.to_string(),
        program_id: config.vault_program_id.clone(),
        slot: i64::try_from(transaction.slot).context("slot does not fit into i64")?,
        block_time_unix: transaction.block_time,
        transaction_error,
        parsed_at,
    };

    let raw_events = decode_raw_events_from_logs(logs, &context)?;
    let mut inserted = 0_u64;
    let mut skipped_duplicates = 0_u64;

    for raw_event in &raw_events {
        let outcome = insert_raw_event(&db_pool, raw_event).await?;
        if outcome.inserted {
            inserted += 1;
        } else {
            skipped_duplicates += 1;
        }
    }

    let total_raw_events = count_raw_events(&db_pool).await?;

    println!("Indexed transaction");
    println!("signature: {signature}");
    println!("cluster: {}", config.cluster);
    println!("rpc url: {}", config.rpc_url);
    println!("program id: {}", config.vault_program_id);
    println!("slot: {}", transaction.slot);
    println!(
        "transaction error: {}",
        transaction_error_label(context.transaction_error.as_ref())
    );
    println!("decoded events: {}", raw_events.len());
    println!("inserted: {inserted}");
    println!("skipped duplicates: {skipped_duplicates}");
    println!("total raw_events rows: {total_raw_events}");

    Ok(())
}

fn fetch_transaction(
    rpc_client: &RpcClient,
    signature: &str,
) -> Result<solana_transaction_status_client_types::EncodedConfirmedTransactionWithStatusMeta> {
    let signature = Signature::from_str(signature).context("invalid transaction signature")?;

    rpc_client
        .get_transaction_with_config(
            &signature,
            RpcTransactionConfig {
                encoding: Some(UiTransactionEncoding::Json),
                commitment: Some(CommitmentConfig::confirmed()),
                max_supported_transaction_version: Some(0),
            },
        )
        .context("fetch transaction")
}

fn parse_args(argv: impl IntoIterator<Item = String>) -> Result<Args> {
    let mut args = Args::default();
    let mut iter = argv.into_iter();

    while let Some(arg) = iter.next() {
        if arg == "--help" || arg == "-h" {
            print_usage();
            std::process::exit(0);
        }

        let value = iter
            .next()
            .with_context(|| format!("missing value for {arg}"))?;

        match arg.as_str() {
            "--signature" => args.signature = Some(value),
            "--rpc-url" => args.rpc_url = Some(value),
            "--cluster" => args.cluster = Some(value),
            "--program-id" => args.program_id = Some(value),
            _ => bail!("unknown argument: {arg}"),
        }
    }

    Ok(args)
}

fn print_usage() {
    println!(
        r#"Usage:
  NO_DNA=1 cargo run --bin index_transaction -- \
    --signature <transaction_signature> \
    [--rpc-url http://127.0.0.1:8899] \
    [--cluster localnet] \
    [--program-id <managed_vault_program_id>]

Environment:
  MANAGED_VAULT_RPC_URL can be used instead of --rpc-url.
  MANAGED_VAULT_CLUSTER can be used instead of --cluster.
  MANAGED_VAULT_PROGRAM_ID can be used instead of --program-id.
  DATABASE_URL controls the Postgres connection.
"#
    );
}

fn transaction_error_label(error: Option<&Value>) -> String {
    error
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string())
}
