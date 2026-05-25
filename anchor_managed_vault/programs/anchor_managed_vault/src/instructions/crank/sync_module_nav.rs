use anchor_lang::prelude::*;

use crate::{
    constants::{
        MODULE_ENTRY_SEED, MODULE_NAV_END, MODULE_NAV_OFFSET, MODULE_VAULT_OFFSET, VAULT_SEED,
    },
    errors::VaultError,
    events::ModuleNavSyncedEvent,
    state::{ModuleEntry, Vault},
};

#[derive(Accounts)]
pub struct SyncModuleNav<'info> {
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.underlying_mint.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [
            MODULE_ENTRY_SEED,
            vault.key().as_ref(),
            module_program.key().as_ref(),
            &module_entry.policy_seed.to_le_bytes(),
        ],
        bump = module_entry.bump,
        constraint = module_entry.vault == vault.key() @ VaultError::InvalidModule,
        constraint = module_entry.module_program_id == module_program.key() @ VaultError::InvalidModule,
        constraint = module_entry.is_active @ VaultError::InvalidModule,
    )]
    pub module_entry: Box<Account<'info, ModuleEntry>>,

    /// CHECK: Generic external module state. The vault verifies the owner,
    /// minimum data length, standard vault field, and standard cached NAV field.
    #[account(
        constraint = module_state.owner == &module_entry.module_program_id @ VaultError::InvalidModuleState,
        constraint = module_state.key() == module_entry.module_state @ VaultError::InvalidModuleState,
    )]
    pub module_state: UncheckedAccount<'info>,

    /// CHECK: Generic external module program. It is bound to ModuleEntry and
    /// must own the passed module_state account.
    #[account(executable)]
    pub module_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SyncModuleNav>) -> Result<()> {
    let module_state_data = ctx.accounts.module_state.try_borrow_data()?;

    require!(
        module_state_data.len() >= MODULE_NAV_END,
        VaultError::InvalidModuleState
    );

    let module_vault = Pubkey::try_from(&module_state_data[MODULE_VAULT_OFFSET..MODULE_NAV_OFFSET])
        .map_err(|_| error!(VaultError::InvalidModuleState))?;

    require_keys_eq!(
        module_vault,
        ctx.accounts.vault.key(),
        VaultError::InvalidModuleState
    );

    let cached_nav_bytes: [u8; 8] = module_state_data[MODULE_NAV_OFFSET..MODULE_NAV_END]
        .try_into()
        .map_err(|_| error!(VaultError::InvalidModuleState))?;
    let new_cached_nav = u64::from_le_bytes(cached_nav_bytes);

    drop(module_state_data);

    let old_cached_nav = ctx.accounts.module_entry.cached_nav;
    let slot = Clock::get()?.slot;

    let modules_nav_total = ctx
        .accounts
        .vault
        .modules_nav_total
        .checked_sub(old_cached_nav)
        .ok_or_else(|| error!(VaultError::MathOverflow))?
        .checked_add(new_cached_nav)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    ctx.accounts.module_entry.cached_nav = new_cached_nav;
    ctx.accounts.module_entry.nav_last_updated_slot = slot;
    ctx.accounts.vault.modules_nav_total = modules_nav_total;

    emit!(ModuleNavSyncedEvent {
        vault: ctx.accounts.vault.key(),
        cranker: ctx.accounts.cranker.key(),
        module_entry: ctx.accounts.module_entry.key(),
        module_program_id: ctx.accounts.module_entry.module_program_id,
        module_state: ctx.accounts.module_state.key(),
        old_cached_nav,
        new_cached_nav,
        modules_nav_total,
        slot,
    });

    Ok(())
}
