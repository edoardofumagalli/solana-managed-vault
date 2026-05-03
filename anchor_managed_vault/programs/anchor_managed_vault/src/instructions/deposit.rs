use anchor_lang::prelude::*;

use anchor_spl::token_interface::{
    self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::VAULT_SEED,
    math::{assets_to_shares_down, total_assets},
    state::Vault,
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump = vault.bump,
        has_one = underlying_mint,
        has_one = share_mint,
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
        token::authority = depositor,
        token::token_program = token_program,
    )]
    pub depositor_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        mint::authority = vault,
        mint::token_program = token_program,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = depositor,
        token::token_program = token_program,
    )]
    pub depositor_share_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> Deposit<'info> {
    fn transfer_underlying_to_vault(&self, amount: u64) -> Result<()> {
        token_interface::transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.depositor_underlying_token_account.to_account_info(),
                    mint: self.underlying_mint.to_account_info(),
                    to: self.vault_token_account.to_account_info(),
                    authority: self.depositor.to_account_info(),
                },
            ),
            amount,
            self.underlying_mint.decimals,
        )
    }

    fn mint_shares_to_depositor(&self, shares: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::mint_to(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                MintTo {
                    mint: self.share_mint.to_account_info(),
                    to: self.depositor_share_token_account.to_account_info(),
                    authority: self.vault.to_account_info(),
                },
                signer_seeds,
            ),
            shares,
        )
    }
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let total_assets_before = total_assets(
        ctx.accounts.vault_token_account.amount,
        ctx.accounts.vault.float_outstanding,
    )?;

    let total_shares_before = ctx.accounts.share_mint.supply;

    let shares_out = assets_to_shares_down(amount, total_assets_before, total_shares_before)?;

    ctx.accounts.transfer_underlying_to_vault(amount)?;

    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_bump = [ctx.accounts.vault.bump];

    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, underlying_mint_key.as_ref(), &vault_bump]];

    ctx.accounts
        .mint_shares_to_depositor(shares_out, signer_seeds)?;

    Ok(())
}
