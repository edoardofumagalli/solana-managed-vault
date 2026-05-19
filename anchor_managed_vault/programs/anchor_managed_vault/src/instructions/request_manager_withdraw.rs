use anchor_lang::prelude::*;

use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::{MANAGER_WITHDRAW_REQUEST_SEED, VAULT_SEED},
    errors::VaultError,
    events::ManagerWithdrawRequestedEvent,
    math::{checked_float_cap, total_assets},
    state::{ManagerWithdrawRequest, Vault},
};

#[derive(Accounts)]
pub struct RequestManagerWithdraw<'info> {
    #[account(mut)]
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

    #[account(
        token::mint = underlying_mint,
        token::token_program = token_program,
    )]
    pub receiver_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = manager,
        space = 8 + ManagerWithdrawRequest::INIT_SPACE,
        seeds = [
            MANAGER_WITHDRAW_REQUEST_SEED,
            vault.key().as_ref(),
            vault.next_manager_withdraw_request_id.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub manager_withdraw_request: Account<'info, ManagerWithdrawRequest>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RequestManagerWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);
    require!(!ctx.accounts.vault.is_shutdown, VaultError::VaultShutdown);
    require_keys_eq!(
        ctx.accounts.manager.key(),
        ctx.accounts.vault.manager,
        VaultError::UnauthorizedManager
    );

    let vault_balance = ctx.accounts.vault_token_account.amount;
    let float_outstanding = ctx.accounts.vault.float_outstanding;

    require!(vault_balance >= amount, VaultError::InsufficientLiquidity);

    let total_assets_now = total_assets(
        vault_balance,
        float_outstanding,
        ctx.accounts.vault.module_nav,
    )?;

    let post_float_outstanding = float_outstanding
        .checked_add(amount)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let post_deployed_value = post_float_outstanding
        .checked_add(ctx.accounts.vault.module_nav)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    checked_float_cap(
        total_assets_now,
        post_deployed_value,
        ctx.accounts.vault.max_float_bps,
    )?;

    let requested_slot = Clock::get()?.slot;
    let executable_after_slot = requested_slot
        .checked_add(ctx.accounts.vault.manager_withdraw_delay_slots)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let vault_key = ctx.accounts.vault.key();
    let manager_key = ctx.accounts.manager.key();
    let receiver_key = ctx.accounts.receiver_underlying_token_account.key();
    let request_key = ctx.accounts.manager_withdraw_request.key();
    let request_id = ctx.accounts.vault.next_manager_withdraw_request_id;

    ctx.accounts
        .manager_withdraw_request
        .set_inner(ManagerWithdrawRequest {
            vault: vault_key,
            manager: manager_key,
            receiver_underlying_token_account: receiver_key,
            request_id,
            amount,
            requested_slot,
            executable_after_slot,
            bump: ctx.bumps.manager_withdraw_request,
        });

    ctx.accounts.vault.next_manager_withdraw_request_id = request_id
        .checked_add(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    emit!(ManagerWithdrawRequestedEvent {
        vault: vault_key,
        manager: manager_key,
        request: request_key,
        request_id,
        receiver_underlying_token_account: receiver_key,
        amount,
        requested_slot,
        executable_after_slot,
    });

    Ok(())
}
