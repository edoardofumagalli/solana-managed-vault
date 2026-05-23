use anchor_lang::prelude::*;

use crate::{
    constants::VAULT_SEED,
    errors::VaultError,
    events::ManagerNominatedEvent,
    state::Vault,
};

#[derive(Accounts)]
pub struct NominateManager<'info> {
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.underlying_mint.as_ref()],
        bump = vault.bump,
        has_one = manager @ VaultError::UnauthorizedManager,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handler(ctx: Context<NominateManager>, new_manager: Pubkey) -> Result<()> {
    require_keys_neq!(new_manager, Pubkey::default(), VaultError::InvalidManager);

    let current_manager = ctx.accounts.vault.manager;
    ctx.accounts.vault.pending_manager = new_manager;

    emit!(ManagerNominatedEvent {
        vault: ctx.accounts.vault.key(),
        current_manager,
        pending_manager: new_manager,
    });

    Ok(())
}
