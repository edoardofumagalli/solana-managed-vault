use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::{
    errors::MockYieldModuleError, events::MockModuleNavCalculatedEvent,
    state::MockModuleState,
};

#[derive(Accounts)]
pub struct CalculateNav<'info> {
    pub payer: Signer<'info>,

    #[account(mut)]
    pub mock_module_state: Account<'info, MockModuleState>,

    #[account(
        token::mint = mock_module_state.underlying_mint,
        token::token_program = token_program,
        constraint = module_token_account.key() == mock_module_state.module_token_account
            @ MockYieldModuleError::InvalidTokenAccount,
    )]
    pub module_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CalculateNav>) -> Result<()> {
    let clock = Clock::get()?;
    let cached_nav = ctx.accounts.module_token_account.amount;

    ctx.accounts.mock_module_state.cached_nav = cached_nav;
    ctx.accounts.mock_module_state.last_updated_slot = clock.slot;

    emit!(MockModuleNavCalculatedEvent {
        vault: ctx.accounts.mock_module_state.vault,
        module_state: ctx.accounts.mock_module_state.key(),
        cached_nav,
        slot: clock.slot,
    });

    Ok(())
}
