use std::sync::Arc;

use solana_client::{rpc_client::RpcClient, rpc_config::RpcSimulateTransactionConfig};
use solana_sdk::{commitment_config::CommitmentConfig, transaction::VersionedTransaction};
use tokio::task;

use crate::api::{ApiError, SimulationSummary};

#[derive(Debug, Clone)]
pub struct TransactionSimulation {
    pub ok: bool,
    pub logs: Vec<String>,
    pub error: Option<String>,
    pub units_consumed: Option<u64>,
}

impl TransactionSimulation {
    fn into_summary(self) -> SimulationSummary {
        SimulationSummary {
            ok: self.ok,
            logs: self.logs,
            error: self.error,
            units_consumed: self.units_consumed,
        }
    }
}

pub async fn simulate_transaction(
    rpc_client: Arc<RpcClient>,
    transaction: VersionedTransaction,
) -> Result<TransactionSimulation, ApiError> {
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

    Ok(TransactionSimulation {
        ok: simulation_result.value.err.is_none(),
        logs: simulation_result.value.logs.unwrap_or_default(),
        error: simulation_result
            .value
            .err
            .map(|error| format!("{error:?}")),
        units_consumed: simulation_result.value.units_consumed,
    })
}

pub async fn simulate_transaction_if_requested(
    rpc_client: Arc<RpcClient>,
    transaction: VersionedTransaction,
    should_simulate: bool,
) -> Result<Option<SimulationSummary>, ApiError> {
    if !should_simulate {
        return Ok(None);
    }

    Ok(Some(
        simulate_transaction(rpc_client, transaction)
            .await?
            .into_summary(),
    ))
}

pub async fn estimate_compute_units(
    rpc_client: Arc<RpcClient>,
    transaction: VersionedTransaction,
) -> Result<u64, ApiError> {
    let simulation = simulate_transaction(rpc_client, transaction).await?;

    if !simulation.ok {
        let error = simulation
            .error
            .unwrap_or_else(|| "unknown simulation error".to_string());
        return Err(ApiError::rpc_simulation_failed(format!(
            "compute unit estimation failed: transaction simulation returned error: {error}"
        )));
    }

    simulation.units_consumed.ok_or_else(|| {
        ApiError::rpc_simulation_failed(
            "compute unit estimation failed: RPC response did not include units consumed",
        )
    })
}
