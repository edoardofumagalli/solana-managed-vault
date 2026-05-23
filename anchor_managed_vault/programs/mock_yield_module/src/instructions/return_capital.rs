use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::{MOCK_MODULE_AUTHORITY_SEED, MOCK_MODULE_STATE_SEED},
    errors::MockYieldModuleError,
    events::MockModuleCapitalReturnedEvent,
    state::MockModuleState,
};

#[derive(Accounts)]
pub struct ReturnCapital<'info> {
    /// CHECK: Must match the vault recorded in module state. It owns the destination token account.
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [MOCK_MODULE_STATE_SEED, mock_module_state.vault.as_ref()],
        bump = mock_module_state.bump,
        constraint = mock_module_state.is_initialized @ MockYieldModuleError::InvalidVault,
    )]
    pub mock_module_state: Account<'info, MockModuleState>,

    /// CHECK: PDA authority that owns the module token account and signs token transfers out.
    #[account(
        seeds = [MOCK_MODULE_AUTHORITY_SEED, mock_module_state.key().as_ref()],
        bump = mock_module_state.module_authority_bump,
    )]
    pub mock_module_authority: UncheckedAccount<'info>,

    #[account(
        mint::token_program = token_program,
        constraint = underlying_mint.key() == mock_module_state.underlying_mint
            @ MockYieldModuleError::InvalidMint,
    )]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = mock_module_authority,
        token::token_program = token_program,
        constraint = module_token_account.key() == mock_module_state.module_token_account
            @ MockYieldModuleError::InvalidTokenAccount,
    )]
    pub module_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ReturnCapital>, amount: u64) -> Result<()> {
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

    let module_state_key = ctx.accounts.mock_module_state.key();
    let module_authority_bump = [ctx.accounts.mock_module_state.module_authority_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[
        MOCK_MODULE_AUTHORITY_SEED,
        module_state_key.as_ref(),
        &module_authority_bump,
    ]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.module_token_account.to_account_info(),
        mint: ctx.accounts.underlying_mint.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.mock_module_authority.to_account_info(),
    };
    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );

    token_interface::transfer_checked(
        cpi_context,
        amount,
        ctx.accounts.underlying_mint.decimals,
    )?;

    ctx.accounts.module_token_account.reload()?;

    let clock = Clock::get()?;
    let cached_nav = ctx.accounts.module_token_account.amount;

    ctx.accounts.mock_module_state.cached_nav = cached_nav;
    ctx.accounts.mock_module_state.last_updated_slot = clock.slot;

    emit!(MockModuleCapitalReturnedEvent {
        vault: ctx.accounts.mock_module_state.vault,
        module_state: ctx.accounts.mock_module_state.key(),
        vault_token_account: ctx.accounts.vault_token_account.key(),
        module_token_account: ctx.accounts.module_token_account.key(),
        amount,
        cached_nav,
        slot: clock.slot,
    });

    Ok(())
}
