use anchor_lang::prelude::*;

use anchor_spl::token_interface::{
    self, BurnChecked, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::{ESCROW_SHARE_SEED, USER_VAULT_POSITION_SEED, VAULT_SEED, WITHDRAW_TICKET_SEED},
    errors::VaultError,
    math::{shares_to_assets_down, total_assets},
    state::{UserVaultPosition, Vault, WithdrawTicket},
};

#[derive(Accounts)]
pub struct ProcessWithdraw<'info> {
    #[account(mut)]
    pub user: SystemAccount<'info>,

    #[account(
        mut,
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
        token::mint = underlying_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [USER_VAULT_POSITION_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        has_one = vault,
        has_one = user,
    )]
    pub user_position: Account<'info, UserVaultPosition>,

    #[account(
        mut,
        seeds = [WITHDRAW_TICKET_SEED, vault.key().as_ref(), user.key().as_ref(), withdraw_ticket.ticket_index.to_le_bytes().as_ref()],
        bump = withdraw_ticket.bump,
        has_one = vault,
        has_one = user,
        has_one = escrow_share_token_account,
        close = user,
    )]
    pub withdraw_ticket: Account<'info, WithdrawTicket>,

    #[account(
        mut,
        seeds = [ESCROW_SHARE_SEED, withdraw_ticket.key().as_ref()],
        bump,
        token::mint = share_mint,
        token::authority = withdraw_ticket,
        token::token_program = token_program,
    )]
    pub escrow_share_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ProcessWithdraw<'info> {
    fn transfer_assets_to_user(&self, amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.vault_token_account.to_account_info(),
                    mint: self.underlying_mint.to_account_info(),
                    to: self.user_underlying_token_account.to_account_info(),
                    authority: self.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            self.underlying_mint.decimals,
        )
    }

    fn burn_escrowed_shares(&self, amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::burn_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                BurnChecked {
                    from: self.escrow_share_token_account.to_account_info(),
                    mint: self.share_mint.to_account_info(),
                    authority: self.withdraw_ticket.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            self.share_mint.decimals,
        )
    }

    fn close_escrow_share_token_account(&self, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::close_account(CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            CloseAccount {
                account: self.escrow_share_token_account.to_account_info(),
                destination: self.user.to_account_info(),
                authority: self.withdraw_ticket.to_account_info(),
            },
            signer_seeds,
        ))
    }
}

pub fn handler(ctx: Context<ProcessWithdraw>) -> Result<()> {
    require_eq!(
        ctx.accounts.withdraw_ticket.ticket_index,
        ctx.accounts.vault.next_ticket_to_process,
        VaultError::TicketOutOfOrder
    );

    require!(
        ctx.accounts.escrow_share_token_account.amount >= ctx.accounts.withdraw_ticket.shares,
        VaultError::InsufficientShares
    );

    let total_assets_now = total_assets(
        ctx.accounts.vault_token_account.amount,
        ctx.accounts.vault.float_outstanding,
    )?;

    let assets_out = shares_to_assets_down(
        ctx.accounts.withdraw_ticket.shares,
        total_assets_now,
        ctx.accounts.share_mint.supply,
    )?;

    require!(
        ctx.accounts.vault_token_account.amount >= assets_out,
        VaultError::InsufficientLiquidity
    );

    let next_pending_ticket_count = ctx
        .accounts
        .user_position
        .pending_ticket_count
        .checked_sub(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let next_ticket_to_process = ctx
        .accounts
        .vault
        .next_ticket_to_process
        .checked_add(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_bump = [ctx.accounts.vault.bump];

    let vault_signer_seeds: &[&[&[u8]]] =
        &[&[VAULT_SEED, underlying_mint_key.as_ref(), &vault_bump]];

    let vault_key = ctx.accounts.vault.key();
    let user_key = ctx.accounts.user.key();
    let ticket_index_bytes = ctx.accounts.withdraw_ticket.ticket_index.to_le_bytes();
    let ticket_bump = [ctx.accounts.withdraw_ticket.bump];

    let ticket_signer_seeds: &[&[&[u8]]] = &[&[
        WITHDRAW_TICKET_SEED,
        vault_key.as_ref(),
        user_key.as_ref(),
        ticket_index_bytes.as_ref(),
        &ticket_bump,
    ]];

    ctx.accounts
        .transfer_assets_to_user(assets_out, vault_signer_seeds)?;

    ctx.accounts.burn_escrowed_shares(
        ctx.accounts.escrow_share_token_account.amount,
        ticket_signer_seeds,
    )?;

    ctx.accounts
        .close_escrow_share_token_account(ticket_signer_seeds)?;

    ctx.accounts.user_position.pending_ticket_count = next_pending_ticket_count;
    ctx.accounts.vault.next_ticket_to_process = next_ticket_to_process;

    Ok(())
}
