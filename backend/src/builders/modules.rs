#![allow(dead_code)]

use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_managed_vault::{
    accounts,
    constants::{MODULE_CALL_AUTHORITY_SEED, MODULE_ENTRY_SEED},
    instruction,
    state::{ModuleEntry, Vault},
    ID as VAULT_PROGRAM_ID,
};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program::ID as SYSTEM_PROGRAM_ID,
};
use spl_token::ID as TOKEN_PROGRAM_ID;

use crate::{
    api::{
        ApiError, DeployToModuleTransactionRequest, ModuleRemainingAccountRequest,
        RecallFromModuleTransactionRequest, RegisterModuleTransactionRequest,
        SyncModuleNavTransactionRequest, ValidatedComputeBudgetRequest,
    },
    builders::common::{parse_positive_u64, parse_pubkey, parse_u64},
};

#[derive(Debug)]
pub struct ParsedRegisterModuleTransactionRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_program: Pubkey,
    pub module_state: Pubkey,
    pub module_underlying_token_account: Pubkey,
    pub policy_seed: u64,
    pub simulate: bool,
}

#[derive(Debug, Clone)]
pub struct ParsedModuleRemainingAccount {
    pub pubkey: Pubkey,
    pub is_writable: bool,
    pub role: Option<String>,
}

#[derive(Debug)]
pub struct ParsedDeployToModuleTransactionRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_entry: Pubkey,
    pub amount: u64,
    pub remaining_accounts: Vec<ParsedModuleRemainingAccount>,
    pub simulate: bool,
    pub compute_budget: ValidatedComputeBudgetRequest,
}

#[derive(Debug)]
pub struct ParsedRecallFromModuleTransactionRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_entry: Pubkey,
    pub amount: u64,
    pub remaining_accounts: Vec<ParsedModuleRemainingAccount>,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct ParsedSyncModuleNavTransactionRequest {
    pub vault: Pubkey,
    pub module_entry: Pubkey,
    pub fee_payer: Pubkey,
    pub simulate: bool,
}

#[derive(Debug)]
pub struct RegisterModuleAccounts {
    pub manager: Pubkey,
    pub vault: Pubkey,
    pub module_entry: Pubkey,
    pub module_state: Pubkey,
    pub module_underlying_token_account: Pubkey,
    pub module_program: Pubkey,
    pub system_program: Pubkey,
    pub policy_seed: u64,
}

#[derive(Debug)]
pub struct DeployToModuleAccounts {
    pub manager: Pubkey,
    pub vault: Pubkey,
    pub module_call_authority: Pubkey,
    pub module_entry: Pubkey,
    pub underlying_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub module_underlying_token_account: Pubkey,
    pub module_program: Pubkey,
    pub token_program: Pubkey,
    pub remaining_accounts: Vec<ParsedModuleRemainingAccount>,
    pub module_state: Pubkey,
    pub policy_seed: u64,
    pub cached_nav: u64,
    pub nav_last_updated_slot: u64,
}

#[derive(Debug)]
pub struct RecallFromModuleAccounts {
    pub manager: Pubkey,
    pub vault: Pubkey,
    pub module_call_authority: Pubkey,
    pub module_entry: Pubkey,
    pub underlying_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub module_program: Pubkey,
    pub token_program: Pubkey,
    pub remaining_accounts: Vec<ParsedModuleRemainingAccount>,
    pub module_state: Pubkey,
    pub policy_seed: u64,
    pub cached_nav: u64,
    pub nav_last_updated_slot: u64,
}

#[derive(Debug)]
pub struct SyncModuleNavAccounts {
    pub cranker: Pubkey,
    pub vault: Pubkey,
    pub module_entry: Pubkey,
    pub module_state: Pubkey,
    pub module_program: Pubkey,
    pub policy_seed: u64,
    pub cached_nav: u64,
    pub nav_last_updated_slot: u64,
}

impl ParsedModuleRemainingAccount {
    pub fn to_account_meta(&self) -> AccountMeta {
        if self.is_writable {
            AccountMeta::new(self.pubkey, false)
        } else {
            AccountMeta::new_readonly(self.pubkey, false)
        }
    }
}

pub fn parse_register_module_request(
    request: RegisterModuleTransactionRequest,
) -> Result<ParsedRegisterModuleTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let manager = parse_pubkey("manager", &request.manager)?;
    let module_program = parse_pubkey("moduleProgram", &request.module_program)?;
    let module_state = parse_pubkey("moduleState", &request.module_state)?;
    let module_underlying_token_account = parse_pubkey(
        "moduleUnderlyingTokenAccount",
        &request.module_underlying_token_account,
    )?;
    let policy_seed = parse_u64("policySeed", &request.policy_seed)?;

    Ok(ParsedRegisterModuleTransactionRequest {
        vault,
        manager,
        module_program,
        module_state,
        module_underlying_token_account,
        policy_seed,
        simulate: request.simulate,
    })
}

pub fn parse_deploy_to_module_request(
    request: DeployToModuleTransactionRequest,
) -> Result<ParsedDeployToModuleTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let manager = parse_pubkey("manager", &request.manager)?;
    let module_entry = parse_pubkey("moduleEntry", &request.module_entry)?;
    let amount = parse_positive_u64("amount", &request.amount)?;
    let remaining_accounts = parse_remaining_accounts(request.remaining_accounts)?;
    let compute_budget = request.compute_budget.validate()?;

    Ok(ParsedDeployToModuleTransactionRequest {
        vault,
        manager,
        module_entry,
        amount,
        remaining_accounts,
        simulate: request.simulate,
        compute_budget,
    })
}

pub fn parse_recall_from_module_request(
    request: RecallFromModuleTransactionRequest,
) -> Result<ParsedRecallFromModuleTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let manager = parse_pubkey("manager", &request.manager)?;
    let module_entry = parse_pubkey("moduleEntry", &request.module_entry)?;
    let amount = parse_positive_u64("amount", &request.amount)?;
    let remaining_accounts = parse_remaining_accounts(request.remaining_accounts)?;

    Ok(ParsedRecallFromModuleTransactionRequest {
        vault,
        manager,
        module_entry,
        amount,
        remaining_accounts,
        simulate: request.simulate,
    })
}

pub fn parse_sync_module_nav_request(
    request: SyncModuleNavTransactionRequest,
) -> Result<ParsedSyncModuleNavTransactionRequest, ApiError> {
    let vault = parse_pubkey("vault", &request.vault)?;
    let module_entry = parse_pubkey("moduleEntry", &request.module_entry)?;
    let fee_payer = parse_pubkey("feePayer", &request.fee_payer)?;

    Ok(ParsedSyncModuleNavTransactionRequest {
        vault,
        module_entry,
        fee_payer,
        simulate: request.simulate,
    })
}

pub fn remaining_account_metas(
    remaining_accounts: &[ParsedModuleRemainingAccount],
) -> Vec<AccountMeta> {
    remaining_accounts
        .iter()
        .map(ParsedModuleRemainingAccount::to_account_meta)
        .collect()
}

pub fn remaining_accounts_include(
    remaining_accounts: &[ParsedModuleRemainingAccount],
    pubkey: Pubkey,
) -> bool {
    remaining_accounts
        .iter()
        .any(|account| account.pubkey == pubkey)
}

pub fn derive_module_entry(vault: Pubkey, module_program: Pubkey, policy_seed: u64) -> Pubkey {
    let policy_seed_bytes = policy_seed.to_le_bytes();

    let (module_entry, _) = Pubkey::find_program_address(
        &[
            MODULE_ENTRY_SEED,
            vault.as_ref(),
            module_program.as_ref(),
            policy_seed_bytes.as_ref(),
        ],
        &VAULT_PROGRAM_ID,
    );

    module_entry
}

pub fn derive_module_call_authority(vault: Pubkey) -> Pubkey {
    let (module_call_authority, _) = Pubkey::find_program_address(
        &[MODULE_CALL_AUTHORITY_SEED, vault.as_ref()],
        &VAULT_PROGRAM_ID,
    );

    module_call_authority
}

pub fn validate_module_entry(
    module_entry: Pubkey,
    expected_vault: Pubkey,
    module_entry_state: &ModuleEntry,
) -> Result<(), ApiError> {
    if module_entry_state.vault != expected_vault {
        return Err(ApiError::invalid_account_state(format!(
            "module entry vault mismatch. expected={}, actual={}",
            expected_vault, module_entry_state.vault
        )));
    }

    if !module_entry_state.is_active {
        return Err(ApiError::invalid_account_state(
            "module entry is not active".to_string(),
        ));
    }

    let expected_module_entry = derive_module_entry(
        module_entry_state.vault,
        module_entry_state.module_program_id,
        module_entry_state.policy_seed,
    );

    if module_entry != expected_module_entry {
        return Err(ApiError::invalid_account_state(format!(
            "module entry PDA mismatch. expected={}, actual={}",
            expected_module_entry, module_entry
        )));
    }

    Ok(())
}

pub fn resolve_register_module_accounts(
    request: &ParsedRegisterModuleTransactionRequest,
) -> RegisterModuleAccounts {
    let module_entry =
        derive_module_entry(request.vault, request.module_program, request.policy_seed);

    RegisterModuleAccounts {
        manager: request.manager,
        vault: request.vault,
        module_entry,
        module_state: request.module_state,
        module_underlying_token_account: request.module_underlying_token_account,
        module_program: request.module_program,
        system_program: SYSTEM_PROGRAM_ID,
        policy_seed: request.policy_seed,
    }
}

pub fn build_register_module_instruction(accounts: &RegisterModuleAccounts) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::RegisterModule {
            manager: accounts.manager,
            vault: accounts.vault,
            module_entry: accounts.module_entry,
            module_state: accounts.module_state,
            module_underlying_token_account: accounts.module_underlying_token_account,
            module_program: accounts.module_program,
            system_program: accounts.system_program,
        }
        .to_account_metas(None),
        data: instruction::RegisterModule {
            policy_seed: accounts.policy_seed,
        }
        .data(),
    }
}

pub fn resolve_deploy_to_module_accounts(
    request: &ParsedDeployToModuleTransactionRequest,
    vault_state: &Vault,
    module_entry_state: &ModuleEntry,
) -> Result<DeployToModuleAccounts, ApiError> {
    validate_module_entry(request.module_entry, request.vault, module_entry_state)?;
    let module_call_authority = derive_module_call_authority(request.vault);

    ensure_remaining_account_absent(
        "remainingAccounts",
        &request.remaining_accounts,
        module_call_authority,
        "module_call_authority",
    )?;
    ensure_remaining_account_absent(
        "remainingAccounts",
        &request.remaining_accounts,
        module_entry_state.module_program_id,
        "module_program",
    )?;
    ensure_remaining_account(
        "remainingAccounts",
        &request.remaining_accounts,
        module_entry_state.module_state,
        "ModuleEntry.module_state",
    )?;
    ensure_remaining_account(
        "remainingAccounts",
        &request.remaining_accounts,
        module_entry_state.module_underlying_token_account,
        "ModuleEntry.module_underlying_token_account",
    )?;

    Ok(DeployToModuleAccounts {
        manager: request.manager,
        vault: request.vault,
        module_call_authority,
        module_entry: request.module_entry,
        underlying_mint: vault_state.underlying_mint,
        vault_token_account: vault_state.vault_token_account,
        module_underlying_token_account: module_entry_state.module_underlying_token_account,
        module_program: module_entry_state.module_program_id,
        token_program: TOKEN_PROGRAM_ID,
        remaining_accounts: request.remaining_accounts.clone(),
        module_state: module_entry_state.module_state,
        policy_seed: module_entry_state.policy_seed,
        cached_nav: module_entry_state.cached_nav,
        nav_last_updated_slot: module_entry_state.nav_last_updated_slot,
    })
}

pub fn build_deploy_to_module_instruction(
    accounts: &DeployToModuleAccounts,
    amount: u64,
) -> Instruction {
    let mut account_metas = accounts::DeployToModule {
        manager: accounts.manager,
        vault: accounts.vault,
        module_call_authority: accounts.module_call_authority,
        module_entry: accounts.module_entry,
        underlying_mint: accounts.underlying_mint,
        vault_token_account: accounts.vault_token_account,
        module_underlying_token_account: accounts.module_underlying_token_account,
        module_program: accounts.module_program,
        token_program: accounts.token_program,
    }
    .to_account_metas(None);

    account_metas.extend(remaining_account_metas(&accounts.remaining_accounts));

    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: account_metas,
        data: instruction::DeployToModule { amount }.data(),
    }
}

pub fn resolve_recall_from_module_accounts(
    request: &ParsedRecallFromModuleTransactionRequest,
    vault_state: &Vault,
    module_entry_state: &ModuleEntry,
) -> Result<RecallFromModuleAccounts, ApiError> {
    validate_module_entry(request.module_entry, request.vault, module_entry_state)?;
    let module_call_authority = derive_module_call_authority(request.vault);

    ensure_remaining_account_absent(
        "remainingAccounts",
        &request.remaining_accounts,
        module_call_authority,
        "module_call_authority",
    )?;
    ensure_remaining_account_absent(
        "remainingAccounts",
        &request.remaining_accounts,
        module_entry_state.module_program_id,
        "module_program",
    )?;
    ensure_remaining_account(
        "remainingAccounts",
        &request.remaining_accounts,
        module_entry_state.module_state,
        "ModuleEntry.module_state",
    )?;
    ensure_remaining_account(
        "remainingAccounts",
        &request.remaining_accounts,
        vault_state.vault_token_account,
        "vault token account",
    )?;

    Ok(RecallFromModuleAccounts {
        manager: request.manager,
        vault: request.vault,
        module_call_authority,
        module_entry: request.module_entry,
        underlying_mint: vault_state.underlying_mint,
        vault_token_account: vault_state.vault_token_account,
        module_program: module_entry_state.module_program_id,
        token_program: TOKEN_PROGRAM_ID,
        remaining_accounts: request.remaining_accounts.clone(),
        module_state: module_entry_state.module_state,
        policy_seed: module_entry_state.policy_seed,
        cached_nav: module_entry_state.cached_nav,
        nav_last_updated_slot: module_entry_state.nav_last_updated_slot,
    })
}

pub fn build_recall_from_module_instruction(
    accounts: &RecallFromModuleAccounts,
    amount: u64,
) -> Instruction {
    let mut account_metas = accounts::RecallFromModule {
        manager: accounts.manager,
        vault: accounts.vault,
        module_call_authority: accounts.module_call_authority,
        module_entry: accounts.module_entry,
        underlying_mint: accounts.underlying_mint,
        vault_token_account: accounts.vault_token_account,
        module_program: accounts.module_program,
        token_program: accounts.token_program,
    }
    .to_account_metas(None);

    account_metas.extend(remaining_account_metas(&accounts.remaining_accounts));

    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: account_metas,
        data: instruction::RecallFromModule { amount }.data(),
    }
}

pub fn resolve_sync_module_nav_accounts(
    request: &ParsedSyncModuleNavTransactionRequest,
    module_entry_state: &ModuleEntry,
) -> Result<SyncModuleNavAccounts, ApiError> {
    validate_module_entry(request.module_entry, request.vault, module_entry_state)?;

    Ok(SyncModuleNavAccounts {
        cranker: request.fee_payer,
        vault: request.vault,
        module_entry: request.module_entry,
        module_state: module_entry_state.module_state,
        module_program: module_entry_state.module_program_id,
        policy_seed: module_entry_state.policy_seed,
        cached_nav: module_entry_state.cached_nav,
        nav_last_updated_slot: module_entry_state.nav_last_updated_slot,
    })
}

pub fn build_sync_module_nav_instruction(accounts: &SyncModuleNavAccounts) -> Instruction {
    Instruction {
        program_id: VAULT_PROGRAM_ID,
        accounts: accounts::SyncModuleNav {
            cranker: accounts.cranker,
            vault: accounts.vault,
            module_entry: accounts.module_entry,
            module_state: accounts.module_state,
            module_program: accounts.module_program,
        }
        .to_account_metas(None),
        data: instruction::SyncModuleNav {}.data(),
    }
}

fn parse_remaining_accounts(
    accounts: Vec<ModuleRemainingAccountRequest>,
) -> Result<Vec<ParsedModuleRemainingAccount>, ApiError> {
    if accounts.is_empty() {
        return Err(ApiError::missing_remaining_account(
            "remainingAccounts must include at least one account",
        ));
    }

    accounts
        .into_iter()
        .enumerate()
        .map(parse_remaining_account)
        .collect()
}

fn parse_remaining_account(
    (index, account): (usize, ModuleRemainingAccountRequest),
) -> Result<ParsedModuleRemainingAccount, ApiError> {
    let field_prefix = format!("remainingAccounts[{index}]");

    if account.is_signer {
        return Err(ApiError::unsupported_signer(format!(
            "{field_prefix}.isSigner must be false in the first backend version"
        )));
    }

    let pubkey = parse_pubkey(&format!("{field_prefix}.pubkey"), &account.pubkey)?;
    let role = normalize_optional_role(account.role);

    Ok(ParsedModuleRemainingAccount {
        pubkey,
        is_writable: account.is_writable,
        role,
    })
}

fn normalize_optional_role(role: Option<String>) -> Option<String> {
    role.and_then(|role| {
        let role = role.trim().to_string();

        if role.is_empty() {
            None
        } else {
            Some(role)
        }
    })
}

fn ensure_remaining_account(
    field: &str,
    remaining_accounts: &[ParsedModuleRemainingAccount],
    required_pubkey: Pubkey,
    label: &str,
) -> Result<(), ApiError> {
    if remaining_accounts_include(remaining_accounts, required_pubkey) {
        return Ok(());
    }

    Err(ApiError::missing_remaining_account(format!(
        "{field} must include {label}: {required_pubkey}"
    )))
}

fn ensure_remaining_account_absent(
    field: &str,
    remaining_accounts: &[ParsedModuleRemainingAccount],
    disallowed_pubkey: Pubkey,
    label: &str,
) -> Result<(), ApiError> {
    if !remaining_accounts_include(remaining_accounts, disallowed_pubkey) {
        return Ok(());
    }

    Err(ApiError::forbidden_remaining_account(format!(
        "{field} must not include {label}: {disallowed_pubkey}"
    )))
}
