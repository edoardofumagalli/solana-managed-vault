use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::MOCK_MODULE_STATE_SEED,
    errors::MockYieldModuleError,
    events::MockModuleDepositedEvent,
    state::MockModuleState,
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub vault_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [MOCK_MODULE_STATE_SEED, mock_module_state.vault.as_ref()],
        bump = mock_module_state.bump,
        constraint = mock_module_state.is_initialized @ MockYieldModuleError::InvalidVault,
    )]
    pub mock_module_state: Account<'info, MockModuleState>,

    #[account(
        mut,
        constraint = module_token_account.key() == mock_module_state.module_token_account
            @ MockYieldModuleError::InvalidTokenAccount,
        constraint = module_token_account.mint == mock_module_state.underlying_mint
            @ MockYieldModuleError::InvalidMint,
    )]
    pub module_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, MockYieldModuleError::InvalidAmount);
    require_keys_eq!(
        ctx.accounts.vault_authority.key(),
        ctx.accounts.mock_module_state.vault,
        MockYieldModuleError::UnauthorizedVault
    );
    require!(
        ctx.accounts.module_token_account.amount >= amount,
        MockYieldModuleError::InsufficientLiquidity
    );

    let clock = Clock::get()?;
    let cached_nav = ctx.accounts.module_token_account.amount;

    ctx.accounts.mock_module_state.cached_nav = cached_nav;
    ctx.accounts.mock_module_state.last_updated_slot = clock.slot;

    emit!(MockModuleDepositedEvent {
        vault: ctx.accounts.mock_module_state.vault,
        module_state: ctx.accounts.mock_module_state.key(),
        module_token_account: ctx.accounts.module_token_account.key(),
        amount,
        cached_nav,
        slot: clock.slot,
    });

    Ok(())
}
