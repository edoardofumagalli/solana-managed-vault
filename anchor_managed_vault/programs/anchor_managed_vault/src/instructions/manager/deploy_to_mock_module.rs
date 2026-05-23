use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use mock_yield_module::{
    self,
    cpi::accounts::Deposit as MockModuleDeposit,
    program::MockYieldModule,
    state::MockModuleState,
};

use crate::{
    constants::{MODULE_ENTRY_SEED, VAULT_SEED},
    errors::VaultError,
    events::ModuleCapitalDeployedEvent,
    math::{checked_float_cap, total_assets},
    state::{ModuleEntry, Vault},
};

#[derive(Accounts)]
pub struct DeployToMockModule<'info> {
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

    #[account(
        mint::token_program = token_program,
    )]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::token_program = token_program,
    )]
    pub module_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mock_yield_module_program: Program<'info, MockYieldModule>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> DeployToMockModule<'info> {
    fn deposit_to_mock_module(&self, amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        let cpi_accounts = MockModuleDeposit {
            vault_authority: self.vault.to_account_info(),
            mock_module_state: self.mock_module_state.to_account_info(),
            underlying_mint: self.underlying_mint.to_account_info(),
            vault_token_account: self.vault_token_account.to_account_info(),
            module_token_account: self.module_token_account.to_account_info(),
            token_program: self.token_program.to_account_info(),
        };

        mock_yield_module::cpi::deposit(
            CpiContext::new_with_signer(
                self.mock_yield_module_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            amount,
        )
    }
}

pub fn handler(ctx: Context<DeployToMockModule>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);
    require!(!ctx.accounts.vault.is_shutdown, VaultError::VaultShutdown);
    require!(
        ctx.accounts.vault_token_account.amount >= amount,
        VaultError::InsufficientLiquidity
    );

    let total_assets_now = total_assets(
        ctx.accounts.vault_token_account.amount,
        ctx.accounts.vault.float_outstanding,
        ctx.accounts.vault.modules_nav_total,
    )?;

    let deployed_value_after = ctx
        .accounts
        .vault
        .float_outstanding
        .checked_add(ctx.accounts.vault.modules_nav_total)
        .ok_or_else(|| error!(VaultError::MathOverflow))?
        .checked_add(amount)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    checked_float_cap(
        total_assets_now,
        deployed_value_after,
        ctx.accounts.vault.max_float_bps,
    )?;

    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_bump = [ctx.accounts.vault.bump];
    let vault_signer_seeds: &[&[&[u8]]] =
        &[&[VAULT_SEED, underlying_mint_key.as_ref(), &vault_bump]];

    ctx.accounts
        .deposit_to_mock_module(amount, vault_signer_seeds)?;

    emit!(ModuleCapitalDeployedEvent {
        vault: ctx.accounts.vault.key(),
        manager: ctx.accounts.manager.key(),
        module_entry: ctx.accounts.module_entry.key(),
        module_program_id: ctx.accounts.mock_yield_module_program.key(),
        module_state: ctx.accounts.mock_module_state.key(),
        vault_token_account: ctx.accounts.vault_token_account.key(),
        module_token_account: ctx.accounts.module_token_account.key(),
        amount,
        deployed_value_after,
    });

    Ok(())
}
