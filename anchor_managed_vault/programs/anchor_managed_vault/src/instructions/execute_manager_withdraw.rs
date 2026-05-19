use anchor_lang::prelude::*;

use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::{MANAGER_WITHDRAW_REQUEST_SEED, VAULT_SEED},
    errors::VaultError,
    events::ManagerWithdrawExecutedEvent,
    math::{checked_float_cap, total_assets},
    state::{ManagerWithdrawRequest, Vault},
};

#[derive(Accounts)]
pub struct ExecuteManagerWithdraw<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

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

    #[account(
        mut,
        seeds = [
            MANAGER_WITHDRAW_REQUEST_SEED,
            vault.key().as_ref(),
            manager_withdraw_request.request_id.to_le_bytes().as_ref(),
        ],
        bump = manager_withdraw_request.bump,
        has_one = vault @ VaultError::InvalidManagerWithdrawRequest,
        has_one = receiver_underlying_token_account @ VaultError::InvalidManagerWithdrawRequest,
        close = executor,
    )]
    pub manager_withdraw_request: Account<'info, ManagerWithdrawRequest>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ExecuteManagerWithdraw<'info> {
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

pub fn handler(ctx: Context<ExecuteManagerWithdraw>) -> Result<()> {
    require!(!ctx.accounts.vault.is_shutdown, VaultError::VaultShutdown);
    require!(
        ctx.accounts.manager_withdraw_request.amount > 0,
        VaultError::InvalidAmount
    );
    require_keys_eq!(
        ctx.accounts.manager_withdraw_request.manager,
        ctx.accounts.vault.manager,
        VaultError::UnauthorizedManager
    );

    let current_slot = Clock::get()?.slot;
    require!(
        current_slot >= ctx.accounts.manager_withdraw_request.executable_after_slot,
        VaultError::ManagerWithdrawTimelockNotElapsed
    );

    let amount = ctx.accounts.manager_withdraw_request.amount;
    let vault_balance = ctx.accounts.vault_token_account.amount;
    let float_outstanding = ctx.accounts.vault.float_outstanding;

    require!(vault_balance >= amount, VaultError::InsufficientLiquidity);

    let total_assets_now = total_assets(
        vault_balance,
        float_outstanding,
        ctx.accounts.vault.modules_nav_total,
    )?;

    let post_float_outstanding = float_outstanding
        .checked_add(amount)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let post_deployed_value = post_float_outstanding
        .checked_add(ctx.accounts.vault.modules_nav_total)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    checked_float_cap(
        total_assets_now,
        post_deployed_value,
        ctx.accounts.vault.max_float_bps,
    )?;

    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_bump = [ctx.accounts.vault.bump];

    let vault_signer_seeds: &[&[&[u8]]] =
        &[&[VAULT_SEED, underlying_mint_key.as_ref(), &vault_bump]];

    ctx.accounts
        .transfer_assets_to_receiver(amount, vault_signer_seeds)?;

    ctx.accounts.vault.float_outstanding = post_float_outstanding;

    emit!(ManagerWithdrawExecutedEvent {
        vault: ctx.accounts.vault.key(),
        manager: ctx.accounts.manager_withdraw_request.manager,
        executor: ctx.accounts.executor.key(),
        request: ctx.accounts.manager_withdraw_request.key(),
        request_id: ctx.accounts.manager_withdraw_request.request_id,
        receiver_underlying_token_account: ctx.accounts.receiver_underlying_token_account.key(),
        amount,
        float_outstanding: post_float_outstanding,
        total_assets: total_assets_now,
    });

    Ok(())
}
