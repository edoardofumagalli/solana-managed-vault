use std::sync::Arc;

use anchor_managed_vault::state::{ManagerWithdrawRequest, ModuleEntry, Vault};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, hash::Hash, pubkey::Pubkey};
use tokio::task;

use crate::{
    api::{ApiError, TransactionBuildResponse, TransactionSummary},
    services::{
        rpc::{fetch_manager_withdraw_request, fetch_module_entry, fetch_vault},
        transaction_builder::UnsignedTransaction,
        transaction_simulator::simulate_transaction_if_requested,
    },
};

pub struct VaultTransactionContext {
    pub latest_blockhash: Hash,
    pub last_valid_block_height: u64,
    pub vault_state: Vault,
}

pub struct ModuleTransactionContext {
    pub latest_blockhash: Hash,
    pub last_valid_block_height: u64,
    pub vault_state: Vault,
    pub module_entry_state: ModuleEntry,
}

pub struct ManagerWithdrawTransactionContext {
    pub latest_blockhash: Hash,
    pub last_valid_block_height: u64,
    pub vault_state: Vault,
    pub request_state: ManagerWithdrawRequest,
}

pub async fn fetch_vault_transaction_context(
    rpc_client: Arc<RpcClient>,
    vault_pubkey: Pubkey,
) -> Result<VaultTransactionContext, ApiError> {
    task::spawn_blocking(move || {
        let (latest_blockhash, last_valid_block_height) =
            latest_blockhash_with_validity(&rpc_client)?;
        let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

        Ok(VaultTransactionContext {
            latest_blockhash,
            last_valid_block_height,
            vault_state,
        })
    })
    .await
    .map_err(rpc_task_error)?
}

pub async fn fetch_module_transaction_context(
    rpc_client: Arc<RpcClient>,
    vault_pubkey: Pubkey,
    module_entry_pubkey: Pubkey,
) -> Result<ModuleTransactionContext, ApiError> {
    task::spawn_blocking(move || {
        let (latest_blockhash, last_valid_block_height) =
            latest_blockhash_with_validity(&rpc_client)?;
        let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;
        let module_entry_state = fetch_module_entry(&rpc_client, &module_entry_pubkey)?;

        Ok(ModuleTransactionContext {
            latest_blockhash,
            last_valid_block_height,
            vault_state,
            module_entry_state,
        })
    })
    .await
    .map_err(rpc_task_error)?
}

pub async fn fetch_manager_withdraw_transaction_context(
    rpc_client: Arc<RpcClient>,
    vault_pubkey: Pubkey,
    manager_withdraw_request: Pubkey,
) -> Result<ManagerWithdrawTransactionContext, ApiError> {
    task::spawn_blocking(move || {
        let (latest_blockhash, last_valid_block_height) =
            latest_blockhash_with_validity(&rpc_client)?;
        let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;
        let request_state = fetch_manager_withdraw_request(&rpc_client, &manager_withdraw_request)?;

        Ok(ManagerWithdrawTransactionContext {
            latest_blockhash,
            last_valid_block_height,
            vault_state,
            request_state,
        })
    })
    .await
    .map_err(rpc_task_error)?
}

pub async fn build_transaction_response(
    rpc_client: Arc<RpcClient>,
    unsigned_transaction: UnsignedTransaction,
    last_valid_block_height: u64,
    summary: TransactionSummary,
    should_simulate: bool,
) -> Result<TransactionBuildResponse, ApiError> {
    let simulation = simulate_transaction_if_requested(
        rpc_client,
        unsigned_transaction.transaction.clone(),
        should_simulate,
    )
    .await?;

    Ok(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary,
        simulation,
    })
}

fn latest_blockhash_with_validity(rpc_client: &RpcClient) -> Result<(Hash, u64), ApiError> {
    rpc_client
        .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
        .map_err(|error| ApiError::rpc_request_failed(format!("RPC request failed: {error}")))
}

fn rpc_task_error(error: task::JoinError) -> ApiError {
    ApiError::rpc_task_failed(format!("RPC task failed: {error}"))
}
