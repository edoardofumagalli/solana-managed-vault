use std::str::FromStr;

use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_managed_vault::{accounts, instruction, state::Vault, ID as VAULT_PROGRAM_ID};
use solana_sdk::{instruction::Instruction, pubkey::Pubkey};
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token::ID as TOKEN_PROGRAM_ID;

use crate::api::{ApiError, DepositTransactionRequest};

#[derive(Debug)]
pub struct ParsedDepositTransactionRequest {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct DepositAccounts {
    pub depositor: Pubkey,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub depositor_underlying_token_account: Pubkey,
    pub share_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub depositor_share_token_account: Pubkey,
    pub token_program: Pubkey,
}

pub fn parse_deposit_request(
    request: DepositTransactionRequest,
) -> Result<ParsedDepositTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let user = parse_pubkey("user", &request.user)?;
    let amount = parse_positive_u64("amount", &request.amount)?;

    Ok(ParsedDepositTransactionRequest {
        vault,
        user,
        amount,
        simulate: request.simulate,
    })
}

pub fn resolve_deposit_accounts(
    request: &ParsedDepositTransactionRequest,
    vault_state: &Vault,
) -> DepositAccounts {
    let depositor_underlying_token_account = get_associated_token_address_with_program_id(
        &request.user,
        &vault_state.underlying_mint,
        &TOKEN_PROGRAM_ID,
    );
    let depositor_share_token_account = get_associated_token_address_with_program_id(
        &request.user,
        &vault_state.share_mint,
        &TOKEN_PROGRAM_ID,
    );

    DepositAccounts {
        depositor: request.user,
        vault: request.vault,
        underlying_mint: vault_state.underlying_mint,
        depositor_underlying_token_account,
        share_mint: vault_state.share_mint,
        vault_token_account: vault_state.vault_token_account,
        depositor_share_token_account,
        token_program: TOKEN_PROGRAM_ID,
    }
}

pub fn build_deposit_instruction(accounts: &DepositAccounts, amount: u64) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::Deposit {
            depositor: accounts.depositor,
            vault: accounts.vault,
            underlying_mint: accounts.underlying_mint,
            depositor_underlying_token_account: accounts.depositor_underlying_token_account,
            share_mint: accounts.share_mint,
            vault_token_account: accounts.vault_token_account,
            depositor_share_token_account: accounts.depositor_share_token_account,
            token_program: accounts.token_program,
        }
        .to_account_metas(None),
        data: instruction::Deposit { amount }.data(),
    }
}

fn parse_pubkey(field: &str, value: &str) -> Result<Pubkey, ApiError> {
    Pubkey::from_str(value).map_err(|_| {
        ApiError::bad_request(format!(
            "{field} must be a valid Solana public key, received: {value}"
        ))
    })
}

fn parse_positive_u64(field: &str, value: &str) -> Result<u64, ApiError> {
    let amount = value.parse::<u64>().map_err(|_| {
        ApiError::bad_request(format!(
            "{field} must be a positive u64 integer string, received: {value}"
        ))
    })?;

    if amount == 0 {
        return Err(ApiError::bad_request(format!(
            "{field} must be greater than zero"
        )));
    }

    Ok(amount)
}
