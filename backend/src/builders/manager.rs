use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_managed_vault::state::ManagerWithdrawRequest;
use anchor_managed_vault::{
    accounts, constants::MANAGER_WITHDRAW_REQUEST_SEED, instruction, state::Vault,
    ID as VAULT_PROGRAM_ID,
};
use solana_sdk::{
    instruction::Instruction, pubkey::Pubkey, system_program::ID as SYSTEM_PROGRAM_ID,
};
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token::ID as TOKEN_PROGRAM_ID;

use crate::{
    api::{
        ApiError, ExecuteManagerWithdrawTransactionRequest, ManagerDepositTransactionRequest,
        ReportFloatValueTransactionRequest, RequestManagerWithdrawTransactionRequest,
    },
    builders::common::{parse_optional_pubkey, parse_positive_u64, parse_pubkey, parse_u64},
};

#[derive(Debug)]
pub struct ParsedManagerDepositTransactionRequest {
    pub vault: Pubkey,
    pub caller: Pubkey,
    pub amount: u64,
    pub source_token_account: Option<Pubkey>,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct ManagerDepositAccounts {
    pub caller: Pubkey,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub caller_underlying_token_account: Pubkey,
    pub vault_token_account: Pubkey,
    pub token_program: Pubkey,
}

#[derive(Debug)]
pub struct ParsedReportFloatValueTransactionRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub reported_float_value: u64,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct ReportFloatValueAccounts {
    pub manager: Pubkey,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub token_program: Pubkey,
}

#[derive(Debug)]
pub struct ParsedRequestManagerWithdrawTransactionRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub amount: u64,
    pub receiver_token_account: Pubkey,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct RequestManagerWithdrawAccounts {
    pub manager: Pubkey,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub receiver_underlying_token_account: Pubkey,
    pub manager_withdraw_request: Pubkey,
    pub token_program: Pubkey,
    pub system_program: Pubkey,
    pub request_id: u64,
    pub manager_withdraw_delay_slots: u64,
}

#[derive(Debug)]
pub struct ParsedExecuteManagerWithdrawTransactionRequest {
    pub vault: Pubkey,
    pub request_id: u64,
    pub fee_payer: Pubkey,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct ExecuteManagerWithdrawAccounts {
    pub executor: Pubkey,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub receiver_underlying_token_account: Pubkey,
    pub manager_withdraw_request: Pubkey,
    pub token_program: Pubkey,
    pub request_id: u64,
    pub amount: u64,
    pub manager: Pubkey,
    pub executable_after_slot: u64,
}

pub fn parse_manager_deposit_request(
    request: ManagerDepositTransactionRequest,
) -> Result<ParsedManagerDepositTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let caller = parse_pubkey("caller", &request.caller)?;
    let amount = parse_positive_u64("amount", &request.amount)?;
    let source_token_account = parse_optional_pubkey(
        "sourceTokenAccount",
        request.source_token_account.as_deref(),
    )?;

    Ok(ParsedManagerDepositTransactionRequest {
        vault,
        caller,
        amount,
        source_token_account,
        simulate: request.simulate,
    })
}

pub fn parse_report_float_value_request(
    request: ReportFloatValueTransactionRequest,
) -> Result<ParsedReportFloatValueTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let manager = parse_pubkey("manager", &request.manager)?;
    let reported_float_value = parse_u64("reportedFloatValue", &request.reported_float_value)?;

    Ok(ParsedReportFloatValueTransactionRequest {
        vault,
        manager,
        reported_float_value,
        simulate: request.simulate,
    })
}

pub fn parse_request_manager_withdraw_request(
    request: RequestManagerWithdrawTransactionRequest,
) -> Result<ParsedRequestManagerWithdrawTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let manager = parse_pubkey("manager", &request.manager)?;
    let amount = parse_positive_u64("amount", &request.amount)?;
    let receiver_token_account =
        parse_pubkey("receiverTokenAccount", &request.receiver_token_account)?;

    Ok(ParsedRequestManagerWithdrawTransactionRequest {
        vault,
        manager,
        amount,
        receiver_token_account,
        simulate: request.simulate,
    })
}

pub fn parse_execute_manager_withdraw_request(
    request: ExecuteManagerWithdrawTransactionRequest,
) -> Result<ParsedExecuteManagerWithdrawTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let request_id = parse_u64("requestId", &request.request_id)?;
    let fee_payer = parse_pubkey("feePayer", &request.fee_payer)?;

    Ok(ParsedExecuteManagerWithdrawTransactionRequest {
        vault,
        request_id,
        fee_payer,
        simulate: request.simulate,
    })
}

pub fn derive_manager_withdraw_request(vault: Pubkey, request_id: u64) -> Pubkey {
    let request_id_bytes = request_id.to_le_bytes();

    let (manager_withdraw_request, _) = Pubkey::find_program_address(
        &[
            MANAGER_WITHDRAW_REQUEST_SEED,
            vault.as_ref(),
            request_id_bytes.as_ref(),
        ],
        &VAULT_PROGRAM_ID,
    );

    manager_withdraw_request
}

pub fn resolve_manager_deposit_accounts(
    request: &ParsedManagerDepositTransactionRequest,
    vault_state: &Vault,
) -> ManagerDepositAccounts {
    let caller_underlying_token_account = request.source_token_account.unwrap_or_else(|| {
        get_associated_token_address_with_program_id(
            &request.caller,
            &vault_state.underlying_mint,
            &TOKEN_PROGRAM_ID,
        )
    });

    ManagerDepositAccounts {
        caller: request.caller,
        vault: request.vault,
        underlying_mint: vault_state.underlying_mint,
        caller_underlying_token_account,
        vault_token_account: vault_state.vault_token_account,
        token_program: TOKEN_PROGRAM_ID,
    }
}

pub fn resolve_report_float_value_accounts(
    request: &ParsedReportFloatValueTransactionRequest,
    vault_state: &Vault,
) -> ReportFloatValueAccounts {
    ReportFloatValueAccounts {
        manager: request.manager,
        vault: request.vault,
        underlying_mint: vault_state.underlying_mint,
        vault_token_account: vault_state.vault_token_account,
        token_program: TOKEN_PROGRAM_ID,
    }
}

pub fn resolve_request_manager_withdraw_accounts(
    request: &ParsedRequestManagerWithdrawTransactionRequest,
    vault_state: &Vault,
) -> RequestManagerWithdrawAccounts {
    let request_id = vault_state.next_manager_withdraw_request_id;
    let manager_withdraw_request = derive_manager_withdraw_request(request.vault, request_id);

    RequestManagerWithdrawAccounts {
        manager: request.manager,
        vault: request.vault,
        underlying_mint: vault_state.underlying_mint,
        vault_token_account: vault_state.vault_token_account,
        receiver_underlying_token_account: request.receiver_token_account,
        manager_withdraw_request,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SYSTEM_PROGRAM_ID,
        request_id,
        manager_withdraw_delay_slots: vault_state.manager_withdraw_delay_slots,
    }
}

pub fn resolve_execute_manager_withdraw_accounts(
    request: &ParsedExecuteManagerWithdrawTransactionRequest,
    vault_state: &Vault,
    request_state: &ManagerWithdrawRequest,
    manager_withdraw_request: Pubkey,
) -> Result<ExecuteManagerWithdrawAccounts, ApiError> {
    if request_state.vault != request.vault {
        return Err(ApiError::invalid_account(format!(
            "manager withdraw request vault mismatch. expected={}, actual={}",
            request.vault, request_state.vault
        )));
    }

    if request_state.request_id != request.request_id {
        return Err(ApiError::invalid_account(format!(
            "manager withdraw request id mismatch. expected={}, actual={}",
            request.request_id, request_state.request_id
        )));
    }

    if request_state.amount == 0 {
        return Err(ApiError::invalid_account(
            "manager withdraw request amount must be greater than zero",
        ));
    }

    if request_state.manager != vault_state.manager {
        return Err(ApiError::invalid_account(format!(
            "manager withdraw request manager does not match current vault manager. expected={}, actual={}",
            vault_state.manager, request_state.manager
        )));
    }

    Ok(ExecuteManagerWithdrawAccounts {
        executor: request.fee_payer,
        vault: request.vault,
        underlying_mint: vault_state.underlying_mint,
        vault_token_account: vault_state.vault_token_account,
        receiver_underlying_token_account: request_state.receiver_underlying_token_account,
        manager_withdraw_request,
        token_program: TOKEN_PROGRAM_ID,
        request_id: request.request_id,
        amount: request_state.amount,
        manager: request_state.manager,
        executable_after_slot: request_state.executable_after_slot,
    })
}

pub fn build_manager_deposit_instruction(
    accounts: &ManagerDepositAccounts,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::ManagerDeposit {
            caller: accounts.caller,
            vault: accounts.vault,
            underlying_mint: accounts.underlying_mint,
            caller_underlying_token_account: accounts.caller_underlying_token_account,
            vault_token_account: accounts.vault_token_account,
            token_program: accounts.token_program,
        }
        .to_account_metas(None),
        data: instruction::ManagerDeposit { amount }.data(),
    }
}

pub fn build_report_float_value_instruction(
    accounts: &ReportFloatValueAccounts,
    reported_float_value: u64,
) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::ReportFloatValue {
            manager: accounts.manager,
            vault: accounts.vault,
            underlying_mint: accounts.underlying_mint,
            vault_token_account: accounts.vault_token_account,
            token_program: accounts.token_program,
        }
        .to_account_metas(None),
        data: instruction::ReportFloatValue {
            reported_float_value,
        }
        .data(),
    }
}

pub fn build_request_manager_withdraw_instruction(
    accounts: &RequestManagerWithdrawAccounts,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::RequestManagerWithdraw {
            manager: accounts.manager,
            vault: accounts.vault,
            underlying_mint: accounts.underlying_mint,
            vault_token_account: accounts.vault_token_account,
            receiver_underlying_token_account: accounts.receiver_underlying_token_account,
            manager_withdraw_request: accounts.manager_withdraw_request,
            token_program: accounts.token_program,
            system_program: accounts.system_program,
        }
        .to_account_metas(None),
        data: instruction::RequestManagerWithdraw { amount }.data(),
    }
}

pub fn build_execute_manager_withdraw_instruction(
    accounts: &ExecuteManagerWithdrawAccounts,
) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::ExecuteManagerWithdraw {
            executor: accounts.executor,
            vault: accounts.vault,
            underlying_mint: accounts.underlying_mint,
            vault_token_account: accounts.vault_token_account,
            receiver_underlying_token_account: accounts.receiver_underlying_token_account,
            manager_withdraw_request: accounts.manager_withdraw_request,
            token_program: accounts.token_program,
        }
        .to_account_metas(None),
        data: instruction::ExecuteManagerWithdraw {}.data(),
    }
}
