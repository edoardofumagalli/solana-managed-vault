use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::VAULT_SEED, errors::VaultError, events::FloatValueReportedEvent,
    math::total_assets, state::Vault,
};

#[derive(Accounts)]
pub struct ReportFloatValue<'info> {
    pub manager: Signer<'info>,

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
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ReportFloatValue>, reported_float_value: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.manager.key(),
        ctx.accounts.vault.manager,
        VaultError::UnauthorizedManager
    );

    let old_float_value = ctx.accounts.vault.float_outstanding;
    let vault_underlying_balance = ctx.accounts.vault_token_account.amount;
    let total_assets_after = total_assets(
        vault_underlying_balance,
        reported_float_value,
        ctx.accounts.vault.modules_nav_total,
    )?;

    ctx.accounts.vault.float_outstanding = reported_float_value;

    emit!(FloatValueReportedEvent {
        vault: ctx.accounts.vault.key(),
        manager: ctx.accounts.manager.key(),
        old_float_value,
        new_float_value: reported_float_value,
        vault_underlying_balance,
        total_assets: total_assets_after,
    });

    Ok(())
}
