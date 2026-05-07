use anchor_lang::prelude::*;

use crate::{
    constants::VAULT_SEED,
    errors::VaultError,
    events::ManagerAcceptedEvent,
    state::Vault,
};

#[derive(Accounts)]
pub struct AcceptManager<'info> {
    pub pending_manager: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.underlying_mint.as_ref()],
        bump = vault.bump,
        constraint = vault.pending_manager == pending_manager.key() @ VaultError::InvalidPendingManager,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handler(ctx: Context<AcceptManager>) -> Result<()> {
    let old_manager = ctx.accounts.vault.manager;
    let new_manager = ctx.accounts.pending_manager.key();

    ctx.accounts.vault.manager = new_manager;
    ctx.accounts.vault.pending_manager = Pubkey::default();

    emit!(ManagerAcceptedEvent {
        vault: ctx.accounts.vault.key(),
        old_manager,
        new_manager,
    });

    Ok(())
}
