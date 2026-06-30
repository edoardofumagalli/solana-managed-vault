use std::sync::Arc;

use anchor_managed_vault::state::{ManagerWithdrawRequest, ModuleEntry, Vault};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig, hash::Hash, instruction::Instruction, pubkey::Pubkey,
};
use tokio::task;

use crate::{
    api::{
        ApiError, ComputeBudgetMode, ComputeBudgetSummary, TransactionBuildResponse,
        TransactionSummary, ValidatedComputeBudgetRequest, MAX_COMPUTE_UNIT_LIMIT,
    },
    services::{
        compute_budget::{
            build_compute_budget_instruction_plan, prepend_compute_budget_instructions,
        },
        rpc::{fetch_manager_withdraw_request, fetch_module_entry, fetch_vault},
        transaction_builder::{build_unsigned_transaction, UnsignedTransaction},
        transaction_simulator::{estimate_compute_units, simulate_transaction_if_requested},
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

pub struct TransactionResponseFromInstructions {
    pub fee_payer: Pubkey,
    pub required_signers: Vec<Pubkey>,
    pub business_instructions: Vec<Instruction>,
    pub recent_blockhash: Hash,
    pub last_valid_block_height: u64,
    pub compute_budget: ValidatedComputeBudgetRequest,
    pub summary: TransactionSummary,
    pub should_simulate: bool,
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
    build_transaction_response_from_unsigned_transaction(
        rpc_client,
        unsigned_transaction,
        last_valid_block_height,
        None,
        summary,
        should_simulate,
    )
    .await
}

pub async fn build_transaction_response_from_instructions(
    rpc_client: Arc<RpcClient>,
    input: TransactionResponseFromInstructions,
) -> Result<TransactionBuildResponse, ApiError> {
    let estimated_units = estimate_compute_units_if_auto(
        rpc_client.clone(),
        input.fee_payer,
        input.required_signers.clone(),
        &input.business_instructions,
        input.recent_blockhash,
        &input.compute_budget,
    )
    .await?;
    let compute_budget_plan =
        build_compute_budget_instruction_plan(&input.compute_budget, estimated_units)?;
    let final_instructions = prepend_compute_budget_instructions(
        compute_budget_plan.instructions,
        &input.business_instructions,
    );
    let unsigned_transaction = build_unsigned_transaction(
        input.fee_payer,
        &final_instructions,
        input.required_signers,
        input.recent_blockhash,
    )?;

    build_transaction_response_from_unsigned_transaction(
        rpc_client,
        unsigned_transaction,
        input.last_valid_block_height,
        compute_budget_plan.summary,
        input.summary,
        input.should_simulate,
    )
    .await
}

async fn build_transaction_response_from_unsigned_transaction(
    rpc_client: Arc<RpcClient>,
    unsigned_transaction: UnsignedTransaction,
    last_valid_block_height: u64,
    compute_budget: Option<ComputeBudgetSummary>,
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
        compute_budget,
        summary,
        simulation,
    })
}

async fn estimate_compute_units_if_auto(
    rpc_client: Arc<RpcClient>,
    fee_payer: Pubkey,
    required_signers: Vec<Pubkey>,
    business_instructions: &[Instruction],
    recent_blockhash: Hash,
    compute_budget: &ValidatedComputeBudgetRequest,
) -> Result<Option<u64>, ApiError> {
    if compute_budget.mode != ComputeBudgetMode::Auto {
        return Ok(None);
    }

    let estimation_compute_budget = ValidatedComputeBudgetRequest {
        mode: ComputeBudgetMode::Fixed,
        unit_limit: Some(MAX_COMPUTE_UNIT_LIMIT),
        margin_bps: None,
        micro_lamports: None,
    };
    let estimation_compute_budget_plan =
        build_compute_budget_instruction_plan(&estimation_compute_budget, None)?;
    let estimation_instructions = prepend_compute_budget_instructions(
        estimation_compute_budget_plan.instructions,
        business_instructions,
    );
    let estimation_transaction = build_unsigned_transaction(
        fee_payer,
        &estimation_instructions,
        required_signers,
        recent_blockhash,
    )?;

    estimate_compute_units(rpc_client, estimation_transaction.transaction)
        .await
        .map(Some)
}

fn latest_blockhash_with_validity(rpc_client: &RpcClient) -> Result<(Hash, u64), ApiError> {
    rpc_client
        .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
        .map_err(|error| ApiError::rpc_request_failed(format!("RPC request failed: {error}")))
}

fn rpc_task_error(error: task::JoinError) -> ApiError {
    ApiError::rpc_task_failed(format!("RPC task failed: {error}"))
}
