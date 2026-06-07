use std::str::FromStr;

use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_managed_vault::{
    accounts,
    constants::{ESCROW_SHARE_SEED, USER_VAULT_POSITION_SEED, WITHDRAW_TICKET_SEED},
    instruction,
    state::Vault,
    ID as VAULT_PROGRAM_ID,
};
use solana_sdk::{
    instruction::Instruction, pubkey::Pubkey, system_program::ID as SYSTEM_PROGRAM_ID,
};
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token::ID as TOKEN_PROGRAM_ID;

use crate::api::{ApiError, CancelWithdrawTransactionRequest, RequestWithdrawTransactionRequest};

#[derive(Debug)]
pub struct ParsedRequestWithdrawTransactionRequest {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_amount: u64,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct RequestWithdrawAccounts {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub user_share_token_account: Pubkey,
    pub user_position: Pubkey,
    pub withdraw_ticket: Pubkey,
    pub escrow_share_token_account: Pubkey,
    pub token_program: Pubkey,
    pub system_program: Pubkey,
    pub ticket_index: u64,
}

#[derive(Debug)]
pub struct ParsedCancelWithdrawTransactionRequest {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub ticket_index: u64,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct CancelWithdrawAccounts {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub share_mint: Pubkey,
    pub user_share_token_account: Pubkey,
    pub user_position: Pubkey,
    pub withdraw_ticket: Pubkey,
    pub escrow_share_token_account: Pubkey,
    pub token_program: Pubkey,
    pub ticket_index: u64,
}

pub fn parse_request_withdraw_request(
    request: RequestWithdrawTransactionRequest,
) -> Result<ParsedRequestWithdrawTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let user = parse_pubkey("user", &request.user)?;
    let shares_amount = parse_positive_u64("sharesAmount", &request.shares_amount)?;

    Ok(ParsedRequestWithdrawTransactionRequest {
        vault,
        user,
        shares_amount,
        simulate: request.simulate,
    })
}

pub fn parse_cancel_withdraw_request(
    request: CancelWithdrawTransactionRequest,
) -> Result<ParsedCancelWithdrawTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let user = parse_pubkey("user", &request.user)?;
    let ticket_index = parse_u64("ticketIndex", &request.ticket_index)?;

    Ok(ParsedCancelWithdrawTransactionRequest {
        vault,
        user,
        ticket_index,
        simulate: request.simulate,
    })
}

pub fn resolve_request_withdraw_accounts(
    request: &ParsedRequestWithdrawTransactionRequest,
    vault_state: &Vault,
) -> RequestWithdrawAccounts {
    let ticket_index = vault_state.total_tickets;
    let ticket_index_bytes = ticket_index.to_le_bytes();

    let user_share_token_account = get_associated_token_address_with_program_id(
        &request.user,
        &vault_state.share_mint,
        &TOKEN_PROGRAM_ID,
    );

    let (user_position, _) = Pubkey::find_program_address(
        &[
            USER_VAULT_POSITION_SEED,
            request.vault.as_ref(),
            request.user.as_ref(),
        ],
        &VAULT_PROGRAM_ID,
    );

    let (withdraw_ticket, _) = Pubkey::find_program_address(
        &[
            WITHDRAW_TICKET_SEED,
            request.vault.as_ref(),
            request.user.as_ref(),
            ticket_index_bytes.as_ref(),
        ],
        &VAULT_PROGRAM_ID,
    );

    let (escrow_share_token_account, _) = Pubkey::find_program_address(
        &[ESCROW_SHARE_SEED, withdraw_ticket.as_ref()],
        &VAULT_PROGRAM_ID,
    );

    RequestWithdrawAccounts {
        user: request.user,
        vault: request.vault,
        underlying_mint: vault_state.underlying_mint,
        share_mint: vault_state.share_mint,
        vault_token_account: vault_state.vault_token_account,
        user_share_token_account,
        user_position,
        withdraw_ticket,
        escrow_share_token_account,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SYSTEM_PROGRAM_ID,
        ticket_index,
    }
}

pub fn resolve_cancel_withdraw_accounts(
    request: &ParsedCancelWithdrawTransactionRequest,
    vault_state: &Vault,
) -> CancelWithdrawAccounts {
    let ticket_index_bytes = request.ticket_index.to_le_bytes();

    let user_share_token_account = get_associated_token_address_with_program_id(
        &request.user,
        &vault_state.share_mint,
        &TOKEN_PROGRAM_ID,
    );

    let (user_position, _) = Pubkey::find_program_address(
        &[
            USER_VAULT_POSITION_SEED,
            request.vault.as_ref(),
            request.user.as_ref(),
        ],
        &VAULT_PROGRAM_ID,
    );

    let (withdraw_ticket, _) = Pubkey::find_program_address(
        &[
            WITHDRAW_TICKET_SEED,
            request.vault.as_ref(),
            request.user.as_ref(),
            ticket_index_bytes.as_ref(),
        ],
        &VAULT_PROGRAM_ID,
    );

    let (escrow_share_token_account, _) = Pubkey::find_program_address(
        &[ESCROW_SHARE_SEED, withdraw_ticket.as_ref()],
        &VAULT_PROGRAM_ID,
    );

    CancelWithdrawAccounts {
        user: request.user,
        vault: request.vault,
        underlying_mint: vault_state.underlying_mint,
        share_mint: vault_state.share_mint,
        user_share_token_account,
        user_position,
        withdraw_ticket,
        escrow_share_token_account,
        token_program: TOKEN_PROGRAM_ID,
        ticket_index: request.ticket_index,
    }
}

pub fn build_request_withdraw_instruction(
    accounts: &RequestWithdrawAccounts,
    shares_amount: u64,
) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::RequestWithdraw {
            user: accounts.user,
            vault: accounts.vault,
            underlying_mint: accounts.underlying_mint,
            share_mint: accounts.share_mint,
            vault_token_account: accounts.vault_token_account,
            user_share_token_account: accounts.user_share_token_account,
            user_position: accounts.user_position,
            withdraw_ticket: accounts.withdraw_ticket,
            escrow_share_token_account: accounts.escrow_share_token_account,
            token_program: accounts.token_program,
            system_program: accounts.system_program,
        }
        .to_account_metas(None),
        data: instruction::RequestWithdraw { shares_amount }.data(),
    }
}

pub fn build_cancel_withdraw_instruction(accounts: &CancelWithdrawAccounts) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::CancelWithdraw {
            user: accounts.user,
            vault: accounts.vault,
            underlying_mint: accounts.underlying_mint,
            share_mint: accounts.share_mint,
            user_share_token_account: accounts.user_share_token_account,
            user_position: accounts.user_position,
            withdraw_ticket: accounts.withdraw_ticket,
            escrow_share_token_account: accounts.escrow_share_token_account,
            token_program: accounts.token_program,
        }
        .to_account_metas(None),
        data: instruction::CancelWithdraw {}.data(),
    }
}

fn parse_pubkey(field: &str, value: &str) -> Result<Pubkey, ApiError> {
    Pubkey::from_str(value).map_err(|_| {
        ApiError::bad_request(format!(
            "{field} must be a valid Solana public key, received: {value}"
        ))
    })
}

fn parse_u64(field: &str, value: &str) -> Result<u64, ApiError> {
    value.parse::<u64>().map_err(|_| {
        ApiError::bad_request(format!(
            "{field} must be a u64 integer string, received: {value}"
        ))
    })
}

fn parse_positive_u64(field: &str, value: &str) -> Result<u64, ApiError> {
    let amount = parse_u64(field, value)?;

    if amount == 0 {
        return Err(ApiError::bad_request(format!(
            "{field} must be greater than zero"
        )));
    }

    Ok(amount)
}
