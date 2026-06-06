use axum::{extract::State, routing::post, Json, Router};
use solana_client::rpc_config::RpcSimulateTransactionConfig;
use solana_sdk::commitment_config::CommitmentConfig;
use tokio::task;

use crate::{
    api::{
        ApiError, ApiResult, DepositTransactionRequest, SimulationSummary,
        TransactionBuildResponse, TransactionSummary,
    },
    builders::deposit::{
        build_unsigned_deposit_transaction, parse_deposit_request, resolve_deposit_accounts,
    },
    services::rpc::fetch_vault,
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/deposit", post(build_deposit_transaction))
}

async fn build_deposit_transaction(
    State(state): State<AppState>,
    Json(request): Json<DepositTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_deposit_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    let deposit_accounts = resolve_deposit_accounts(&parsed_request, &vault_state);
    let unsigned_transaction = build_unsigned_deposit_transaction(
        &deposit_accounts,
        parsed_request.amount,
        latest_blockhash,
    )?;

    let simulation = if parsed_request.simulate {
        let rpc_client = state.rpc_client.clone();
        let transaction = unsigned_transaction.transaction.clone();

        let simulation_result = task::spawn_blocking(move || {
            rpc_client
                .simulate_transaction_with_config(
                    &transaction,
                    RpcSimulateTransactionConfig {
                        sig_verify: false,
                        replace_recent_blockhash: false,
                        commitment: Some(CommitmentConfig::confirmed()),
                        ..RpcSimulateTransactionConfig::default()
                    },
                )
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC simulation failed: {error}"))
                })
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

        Some(SimulationSummary {
            ok: simulation_result.value.err.is_none(),
            logs: simulation_result.value.logs.unwrap_or_default(),
            error: simulation_result
                .value
                .err
                .map(|error| format!("{error:?}")),
            units_consumed: simulation_result.value.units_consumed,
        })
    } else {
        None
    };

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: TransactionSummary {
            action: "deposit".to_string(),
            vault: parsed_request.vault.to_string(),
            amount: parsed_request.amount.to_string(),
        },
        simulation,
    }))
}
