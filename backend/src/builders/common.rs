use std::str::FromStr;

use anchor_managed_vault::state::Vault;
use solana_sdk::pubkey::Pubkey;

use crate::api::{ApiError, TransactionSummary};

pub const ACTOR_ROLE_CALLER: &str = "caller";
#[allow(dead_code)]
pub const ACTOR_ROLE_EMERGENCY_ADMIN: &str = "emergency_admin";
#[allow(dead_code)]
pub const ACTOR_ROLE_EXECUTOR: &str = "executor";
pub const ACTOR_ROLE_MANAGER: &str = "manager";
pub const ACTOR_ROLE_PENDING_MANAGER: &str = "pending_manager";

pub fn parse_pubkey(field: &str, value: &str) -> Result<Pubkey, ApiError> {
    Pubkey::from_str(value).map_err(|_| {
        ApiError::invalid_pubkey(format!(
            "{field} must be a valid Solana public key, received: {value}"
        ))
    })
}

pub fn parse_optional_pubkey(field: &str, value: Option<&str>) -> Result<Option<Pubkey>, ApiError> {
    value.map(|value| parse_pubkey(field, value)).transpose()
}

pub fn parse_u64(field: &str, value: &str) -> Result<u64, ApiError> {
    value.parse::<u64>().map_err(|_| {
        ApiError::invalid_integer(format!(
            "{field} must be a u64 integer string, received: {value}"
        ))
    })
}

pub fn parse_positive_u64(field: &str, value: &str) -> Result<u64, ApiError> {
    let amount = value.parse::<u64>().map_err(|_| {
        ApiError::invalid_amount(format!(
            "{field} must be a positive u64 integer string, received: {value}"
        ))
    })?;

    if amount == 0 {
        return Err(ApiError::invalid_amount(format!(
            "{field} must be greater than zero"
        )));
    }

    Ok(amount)
}

pub fn ensure_manager_role(vault_state: &Vault, manager: Pubkey) -> Result<(), ApiError> {
    if manager != vault_state.manager {
        return Err(ApiError::invalid_signer_role(format!(
            "provided manager does not match vault manager. expected={}, received={}",
            vault_state.manager, manager
        )));
    }

    Ok(())
}

pub fn ensure_pending_manager_role(
    vault_state: &Vault,
    pending_manager: Pubkey,
) -> Result<(), ApiError> {
    if pending_manager != vault_state.pending_manager {
        return Err(ApiError::invalid_signer_role(format!(
            "provided pendingManager does not match vault pending manager. expected={}, received={}",
            vault_state.pending_manager, pending_manager
        )));
    }

    Ok(())
}

#[allow(dead_code)]
pub fn ensure_emergency_admin_role(
    vault_state: &Vault,
    emergency_admin: Pubkey,
) -> Result<(), ApiError> {
    if emergency_admin != vault_state.emergency_admin {
        return Err(ApiError::invalid_signer_role(format!(
            "provided emergencyAdmin does not match vault emergency admin. expected={}, received={}",
            vault_state.emergency_admin, emergency_admin
        )));
    }

    Ok(())
}

pub fn with_caller_actor(summary: TransactionSummary, caller: Pubkey) -> TransactionSummary {
    summary.with_actor(ACTOR_ROLE_CALLER, caller)
}

#[allow(dead_code)]
pub fn with_emergency_admin_actor(
    summary: TransactionSummary,
    emergency_admin: Pubkey,
) -> TransactionSummary {
    summary.with_actor(ACTOR_ROLE_EMERGENCY_ADMIN, emergency_admin)
}

#[allow(dead_code)]
pub fn with_executor_actor(summary: TransactionSummary, executor: Pubkey) -> TransactionSummary {
    summary.with_actor(ACTOR_ROLE_EXECUTOR, executor)
}

pub fn with_manager_actor(summary: TransactionSummary, manager: Pubkey) -> TransactionSummary {
    summary.with_actor(ACTOR_ROLE_MANAGER, manager)
}

pub fn with_pending_manager_actor(
    summary: TransactionSummary,
    pending_manager: Pubkey,
) -> TransactionSummary {
    summary.with_actor(ACTOR_ROLE_PENDING_MANAGER, pending_manager)
}
