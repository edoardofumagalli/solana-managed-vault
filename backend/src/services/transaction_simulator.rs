use std::sync::Arc;

use solana_client::{rpc_client::RpcClient, rpc_config::RpcSimulateTransactionConfig};
use solana_sdk::{commitment_config::CommitmentConfig, transaction::VersionedTransaction};
use tokio::task;

use crate::api::{ApiError, SimulationSummary};

pub async fn simulate_transaction_if_requested(
    rpc_client: Arc<RpcClient>,
    transaction: VersionedTransaction,
    should_simulate: bool,
) -> Result<Option<SimulationSummary>, ApiError> {
    if !should_simulate {
        return Ok(None);
    }

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
                ApiError::rpc_simulation_failed(format!("RPC simulation failed: {error}"))
            })
    })
    .await
    .map_err(|error| ApiError::rpc_task_failed(format!("RPC task failed: {error}")))??;

    Ok(Some(SimulationSummary {
        ok: simulation_result.value.err.is_none(),
        logs: simulation_result.value.logs.unwrap_or_default(),
        error: simulation_result
            .value
            .err
            .map(|error| format!("{error:?}")),
        units_consumed: simulation_result.value.units_consumed,
    }))
}
