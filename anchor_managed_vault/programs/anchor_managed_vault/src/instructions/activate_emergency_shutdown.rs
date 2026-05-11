use anchor_lang::prelude::*;

use crate::{
    constants::VAULT_SEED, errors::VaultError, events::EmergencyShutdownActivatedEvent,
    state::Vault,
};

#[derive(Accounts)]
pub struct ActivateEmergencyShutdown<'info> {
    pub emergency_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.underlying_mint.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handler(ctx: Context<ActivateEmergencyShutdown>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let emergency_admin = ctx.accounts.emergency_admin.key();

    require_keys_eq!(
        emergency_admin,
        vault.emergency_admin,
        VaultError::UnauthorizedEmergencyAdmin
    );
    require!(!vault.is_shutdown, VaultError::ShutdownAlreadyActive);

    let shutdown_slot = Clock::get()?.slot;

    vault.is_shutdown = true;
    vault.shutdown_slot = shutdown_slot;

    emit!(EmergencyShutdownActivatedEvent {
        vault: vault.key(),
        emergency_admin,
        shutdown_slot,
        float_outstanding: vault.float_outstanding,
    });

    Ok(())
}
