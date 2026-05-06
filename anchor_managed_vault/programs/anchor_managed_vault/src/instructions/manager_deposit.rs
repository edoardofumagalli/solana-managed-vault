use anchor_lang::prelude::*;

use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::VAULT_SEED, errors::VaultError, state::Vault};

#[derive(Accounts)]
pub struct ManagerDeposit<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump = vault.bump,
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
        token::authority = caller,
        token::token_program = token_program,
    )]
    pub caller_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ManagerDeposit<'info> {
    fn transfer_assets_to_vault(&self, amount: u64) -> Result<()> {
        token_interface::transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.caller_underlying_token_account.to_account_info(),
                    mint: self.underlying_mint.to_account_info(),
                    to: self.vault_token_account.to_account_info(),
                    authority: self.caller.to_account_info(),
                },
            ),
            amount,
            self.underlying_mint.decimals,
        )
    }
}

pub fn handler(ctx: Context<ManagerDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);

    let float_outstanding = ctx.accounts.vault.float_outstanding;

    let returned_float = amount.min(float_outstanding);

    let new_float_outstanding = float_outstanding
        .checked_sub(returned_float)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    ctx.accounts.transfer_assets_to_vault(amount)?;

    ctx.accounts.vault.float_outstanding = new_float_outstanding;

    Ok(())
}
