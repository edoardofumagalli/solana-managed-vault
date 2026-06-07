use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_managed_vault::{accounts, instruction, ID as VAULT_PROGRAM_ID};
use solana_sdk::{instruction::Instruction, pubkey::Pubkey};

use crate::{
    api::{
        AcceptManagerTransactionRequest, ActivateEmergencyShutdownTransactionRequest, ApiError,
        NominateManagerTransactionRequest,
    },
    builders::common::parse_pubkey,
};

#[derive(Debug)]
pub struct ParsedActivateEmergencyShutdownTransactionRequest {
    pub vault: Pubkey,
    pub emergency_admin: Pubkey,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct ActivateEmergencyShutdownAccounts {
    pub emergency_admin: Pubkey,
    pub vault: Pubkey,
}

#[derive(Debug)]
pub struct ParsedNominateManagerTransactionRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub new_manager: Pubkey,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct NominateManagerAccounts {
    pub manager: Pubkey,
    pub vault: Pubkey,
}

#[derive(Debug)]
pub struct ParsedAcceptManagerTransactionRequest {
    pub vault: Pubkey,
    pub pending_manager: Pubkey,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct AcceptManagerAccounts {
    pub pending_manager: Pubkey,
    pub vault: Pubkey,
}

pub fn parse_activate_emergency_shutdown_request(
    request: ActivateEmergencyShutdownTransactionRequest,
) -> Result<ParsedActivateEmergencyShutdownTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let emergency_admin = parse_pubkey("emergencyAdmin", &request.emergency_admin)?;

    Ok(ParsedActivateEmergencyShutdownTransactionRequest {
        vault,
        emergency_admin,
        simulate: request.simulate,
    })
}

pub fn parse_nominate_manager_request(
    request: NominateManagerTransactionRequest,
) -> Result<ParsedNominateManagerTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let manager = parse_pubkey("manager", &request.manager)?;
    let new_manager = parse_pubkey("newManager", &request.new_manager)?;

    if new_manager == Pubkey::default() {
        return Err(ApiError::bad_request(
            "newManager must not be the default public key",
        ));
    }

    Ok(ParsedNominateManagerTransactionRequest {
        vault,
        manager,
        new_manager,
        simulate: request.simulate,
    })
}

pub fn parse_accept_manager_request(
    request: AcceptManagerTransactionRequest,
) -> Result<ParsedAcceptManagerTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let pending_manager = parse_pubkey("pendingManager", &request.pending_manager)?;

    Ok(ParsedAcceptManagerTransactionRequest {
        vault,
        pending_manager,
        simulate: request.simulate,
    })
}

pub fn resolve_activate_emergency_shutdown_accounts(
    request: &ParsedActivateEmergencyShutdownTransactionRequest,
) -> ActivateEmergencyShutdownAccounts {
    ActivateEmergencyShutdownAccounts {
        emergency_admin: request.emergency_admin,
        vault: request.vault,
    }
}

pub fn resolve_nominate_manager_accounts(
    request: &ParsedNominateManagerTransactionRequest,
) -> NominateManagerAccounts {
    NominateManagerAccounts {
        manager: request.manager,
        vault: request.vault,
    }
}

pub fn resolve_accept_manager_accounts(
    request: &ParsedAcceptManagerTransactionRequest,
) -> AcceptManagerAccounts {
    AcceptManagerAccounts {
        pending_manager: request.pending_manager,
        vault: request.vault,
    }
}

pub fn build_activate_emergency_shutdown_instruction(
    accounts: &ActivateEmergencyShutdownAccounts,
) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::ActivateEmergencyShutdown {
            emergency_admin: accounts.emergency_admin,
            vault: accounts.vault,
        }
        .to_account_metas(None),
        data: instruction::ActivateEmergencyShutdown {}.data(),
    }
}

pub fn build_nominate_manager_instruction(
    accounts: &NominateManagerAccounts,
    new_manager: Pubkey,
) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::NominateManager {
            manager: accounts.manager,
            vault: accounts.vault,
        }
        .to_account_metas(None),
        data: instruction::NominateManager { new_manager }.data(),
    }
}

pub fn build_accept_manager_instruction(accounts: &AcceptManagerAccounts) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::AcceptManager {
            pending_manager: accounts.pending_manager,
            vault: accounts.vault,
        }
        .to_account_metas(None),
        data: instruction::AcceptManager {}.data(),
    }
}
