use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::{MAX_MODULES_PER_VAULT, MODULE_ENTRY_SEED, VAULT_SEED},
    errors::VaultError,
    events::ModuleRegisteredEvent,
    state::{ModuleEntry, Vault},
};

#[derive(Accounts)]
#[instruction(policy_seed: u64)]
pub struct RegisterModule<'info> {
    #[account(mut)]
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.underlying_mint.as_ref()],
        bump = vault.bump,
        has_one = manager @ VaultError::UnauthorizedManager,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = manager,
        space = 8 + ModuleEntry::INIT_SPACE,
        seeds = [
            MODULE_ENTRY_SEED,
            vault.key().as_ref(),
            module_program.key().as_ref(),
            &policy_seed.to_le_bytes(),
        ],
        bump,
    )]
    pub module_entry: Box<Account<'info, ModuleEntry>>,

    /// CHECK: Generic external module state. It must be owned by the registered module program.
    #[account(
        constraint = module_state.owner == &module_program.key() @ VaultError::InvalidModuleState,
    )]
    pub module_state: UncheckedAccount<'info>,

    #[account(
        constraint = module_underlying_token_account.mint == vault.underlying_mint
            @ VaultError::InvalidModuleState,
    )]
    pub module_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Generic external module program. Anchor cannot know its concrete
    /// type, but it must be an executable program account.
    #[account(executable)]
    pub module_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterModule>, policy_seed: u64) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let manager_key = ctx.accounts.manager.key();
    let module_entry_key = ctx.accounts.module_entry.key();
    let module_program_id = ctx.accounts.module_program.key();
    let module_state_key = ctx.accounts.module_state.key();
    let module_underlying_token_account_key = ctx.accounts.module_underlying_token_account.key();

    let vault = &mut ctx.accounts.vault;

    require!(!vault.is_shutdown, VaultError::VaultShutdown);
    require!(
        vault.module_count < MAX_MODULES_PER_VAULT,
        VaultError::MaxModulesReached
    );

    ctx.accounts.module_entry.set_inner(ModuleEntry {
        vault: vault_key,
        module_program_id,
        policy_seed,
        module_state: module_state_key,
        module_underlying_token_account: module_underlying_token_account_key,
        cached_nav: 0,
        nav_last_updated_slot: 0,
        is_active: true,
        bump: ctx.bumps.module_entry,
    });

    vault.module_count = vault
        .module_count
        .checked_add(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    emit!(ModuleRegisteredEvent {
        vault: vault_key,
        manager: manager_key,
        module_entry: module_entry_key,
        module_program_id,
        policy_seed,
        module_state: module_state_key,
        module_underlying_token_account: module_underlying_token_account_key,
        module_count: vault.module_count,
    });

    Ok(())
}
