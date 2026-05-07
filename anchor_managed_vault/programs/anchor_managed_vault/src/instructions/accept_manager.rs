use anchor_lang::prelude::*;

use crate::{constants::VAULT_SEED, errors::VaultError, state::Vault};

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
    ctx.accounts.vault.manager = ctx.accounts.pending_manager.key();
    ctx.accounts.vault.pending_manager = Pubkey::default();

    Ok(())
}
