use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use mock_yield_module::{
    self, cpi::accounts::ReturnCapital as MockModuleReturnCapital, program::MockYieldModule,
    state::MockModuleState,
};

use crate::{
    constants::{MODULE_ENTRY_SEED, VAULT_SEED},
    errors::VaultError,
    events::ModuleCapitalRecalledEvent,
    state::{ModuleEntry, Vault},
};

#[derive(Accounts)]
pub struct RecallFromMockModule<'info> {
    pub manager: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump = vault.bump,
        has_one = manager @ VaultError::UnauthorizedManager,
        has_one = underlying_mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [
            MODULE_ENTRY_SEED,
            vault.key().as_ref(),
            mock_yield_module_program.key().as_ref(),
            &module_entry.policy_seed.to_le_bytes(),
        ],
        bump = module_entry.bump,
        constraint = module_entry.vault == vault.key() @ VaultError::InvalidModule,
        constraint = module_entry.module_program_id == mock_yield_module_program.key() @ VaultError::InvalidModule,
        constraint = module_entry.is_active @ VaultError::InvalidModule,
        constraint = module_entry.module_state == mock_module_state.key() @ VaultError::InvalidModule,
        constraint = module_entry.module_underlying_token_account == module_token_account.key()
            @ VaultError::InvalidModule,
    )]
    pub module_entry: Box<Account<'info, ModuleEntry>>,

    #[account(
        mut,
        constraint = mock_module_state.vault == vault.key() @ VaultError::InvalidModuleState,
        constraint = mock_module_state.underlying_mint == underlying_mint.key() @ VaultError::InvalidModuleState,
        constraint = mock_module_state.module_token_account == module_token_account.key()
            @ VaultError::InvalidModuleState,
    )]
    pub mock_module_state: Account<'info, MockModuleState>,

    /// CHECK: PDA authority owned by the mock module. The CPI target validates
    /// the PDA seeds and uses it to sign the transfer out of the module account.
    pub mock_module_authority: UncheckedAccount<'info>,

    #[account(
        mint::token_program = token_program,
    )]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = mock_module_authority,
        token::token_program = token_program,
    )]
    pub module_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mock_yield_module_program: Program<'info, MockYieldModule>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> RecallFromMockModule<'info> {
    fn return_capital_from_mock_module(&self, amount: u64) -> Result<()> {
        let cpi_accounts = MockModuleReturnCapital {
            vault_authority: self.vault.to_account_info(),
            mock_module_state: self.mock_module_state.to_account_info(),
            mock_module_authority: self.mock_module_authority.to_account_info(),
            underlying_mint: self.underlying_mint.to_account_info(),
            module_token_account: self.module_token_account.to_account_info(),
            vault_token_account: self.vault_token_account.to_account_info(),
            token_program: self.token_program.to_account_info(),
        };

        mock_yield_module::cpi::return_capital(
            CpiContext::new(
                self.mock_yield_module_program.to_account_info(),
                cpi_accounts,
            ),
            amount,
        )
    }
}

pub fn handler(ctx: Context<RecallFromMockModule>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);
    require!(
        ctx.accounts.module_token_account.amount >= amount,
        VaultError::InsufficientLiquidity
    );

    ctx.accounts.return_capital_from_mock_module(amount)?;
    ctx.accounts.mock_module_state.reload()?;

    emit!(ModuleCapitalRecalledEvent {
        vault: ctx.accounts.vault.key(),
        manager: ctx.accounts.manager.key(),
        module_entry: ctx.accounts.module_entry.key(),
        module_program_id: ctx.accounts.mock_yield_module_program.key(),
        module_state: ctx.accounts.mock_module_state.key(),
        vault_token_account: ctx.accounts.vault_token_account.key(),
        module_token_account: ctx.accounts.module_token_account.key(),
        amount,
        module_cached_nav_after: ctx.accounts.mock_module_state.cached_nav,
    });

    Ok(())
}
