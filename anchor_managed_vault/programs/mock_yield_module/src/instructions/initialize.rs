use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{MOCK_MODULE_AUTHORITY_SEED, MOCK_MODULE_STATE_SEED},
    errors::MockYieldModuleError,
    events::MockModuleInitializedEvent,
    state::MockModuleState,
};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Stored in module state. The vault program will later validate this relationship.
    pub vault: UncheckedAccount<'info>,

    #[account(
        mint::token_program = token_program,
    )]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        space = 8 + MockModuleState::INIT_SPACE,
        seeds = [MOCK_MODULE_STATE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub mock_module_state: Account<'info, MockModuleState>,

    /// CHECK: PDA authority for the module token account.
    #[account(
        seeds = [MOCK_MODULE_AUTHORITY_SEED, mock_module_state.key().as_ref()],
        bump,
    )]
    pub mock_module_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = underlying_mint,
        associated_token::authority = mock_module_authority,
        associated_token::token_program = token_program,
    )]
    pub module_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, vault_program_id: Pubkey) -> Result<()> {
    require_keys_neq!(
        vault_program_id,
        Pubkey::default(),
        MockYieldModuleError::InvalidVaultProgram
    );

    let clock = Clock::get()?;

    ctx.accounts.mock_module_state.set_inner(MockModuleState {
        bump: ctx.bumps.mock_module_state,
        vault: ctx.accounts.vault.key(),
        cached_nav: 0,
        last_updated_slot: clock.slot,
        vault_program_id,
        underlying_mint: ctx.accounts.underlying_mint.key(),
        module_token_account: ctx.accounts.module_token_account.key(),
        module_authority_bump: ctx.bumps.mock_module_authority,
        is_initialized: true,
    });

    emit!(MockModuleInitializedEvent {
        vault: ctx.accounts.vault.key(),
        module_state: ctx.accounts.mock_module_state.key(),
        module_token_account: ctx.accounts.module_token_account.key(),
        underlying_mint: ctx.accounts.underlying_mint.key(),
    });

    Ok(())
}
