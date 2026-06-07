use anchor_lang::AccountDeserialize;
use anchor_managed_vault::{
    state::{ManagerWithdrawRequest, Vault},
    ID as VAULT_PROGRAM_ID,
};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};

use crate::{api::ApiError, config::AppConfig};

pub fn create_rpc_client(config: &AppConfig) -> RpcClient {
    RpcClient::new_with_commitment(config.rpc_url.clone(), CommitmentConfig::confirmed())
}

pub fn fetch_vault(rpc_client: &RpcClient, vault: &Pubkey) -> Result<Vault, ApiError> {
    let account = rpc_client
        .get_account(vault)
        .map_err(|error| ApiError::not_found(format!("vault account not found: {error}")))?;

    if account.owner != VAULT_PROGRAM_ID {
        return Err(ApiError::invalid_account(format!(
            "vault account has invalid owner. expected={}, actual={}",
            VAULT_PROGRAM_ID, account.owner
        )));
    }

    Vault::try_deserialize(&mut account.data.as_slice()).map_err(|error| {
        ApiError::invalid_account(format!("failed to deserialize vault account: {error}"))
    })
}

pub fn fetch_manager_withdraw_request(
    rpc_client: &RpcClient,
    manager_withdraw_request: &Pubkey,
) -> Result<ManagerWithdrawRequest, ApiError> {
    let account = rpc_client
        .get_account(manager_withdraw_request)
        .map_err(|error| {
            ApiError::not_found(format!(
                "manager withdraw request account not found: {error}"
            ))
        })?;

    if account.owner != VAULT_PROGRAM_ID {
        return Err(ApiError::invalid_account(format!(
            "manager withdraw request account has invalid owner. expected={}, actual={}",
            VAULT_PROGRAM_ID, account.owner
        )));
    }

    ManagerWithdrawRequest::try_deserialize(&mut account.data.as_slice()).map_err(|error| {
        ApiError::invalid_account(format!(
            "failed to deserialize manager withdraw request account: {error}"
        ))
    })
}
