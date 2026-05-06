use anchor_lang::prelude::*;

use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::VAULT_SEED,
    errors::VaultError,
    math::{checked_float_cap, total_assets},
    state::Vault,
};

#[derive(Accounts)]
pub struct ManagerWithdraw<'info> {
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump = vault.bump,
        has_one = manager @ VaultError::UnauthorizedManager,
        has_one = underlying_mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

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
    pub receiver_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ManagerWithdraw<'info> {
    fn transfer_assets_to_receiver(&self, amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.vault_token_account.to_account_info(),
                    mint: self.underlying_mint.to_account_info(),
                    to: self.receiver_underlying_token_account.to_account_info(),
                    authority: self.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            self.underlying_mint.decimals,
        )
    }
}

pub fn handler(ctx: Context<ManagerWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);

    let vault_balance = ctx.accounts.vault_token_account.amount;
    let float_outstanding = ctx.accounts.vault.float_outstanding;

    require!(vault_balance >= amount, VaultError::InsufficientLiquidity);

    let total_assets_now = total_assets(vault_balance, float_outstanding)?;

    let post_float_outstanding = float_outstanding
        .checked_add(amount)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let max_float_bps = ctx.accounts.vault.max_float_bps;

    checked_float_cap(total_assets_now, post_float_outstanding, max_float_bps)?;

    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_bump = [ctx.accounts.vault.bump];

    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, underlying_mint_key.as_ref(), &vault_bump]];

    ctx.accounts
        .transfer_assets_to_receiver(amount, signer_seeds)?;

    ctx.accounts.vault.float_outstanding = post_float_outstanding;

    Ok(())
}
