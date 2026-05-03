use anchor_lang::prelude::*;

use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::{ESCROW_SHARE_SEED, USER_VAULT_POSITION_SEED, VAULT_SEED, WITHDRAW_TICKET_SEED},
    errors::VaultError,
    state::{UserVaultPosition, Vault, WithdrawTicket},
};

#[derive(Accounts)]
pub struct CancelWithdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump = vault.bump,
        has_one = underlying_mint,
        has_one = share_mint,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mint::token_program = token_program,
    )]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mint::authority = vault,
        mint::token_program = token_program,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_share_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [USER_VAULT_POSITION_SEED, vault.key().as_ref(), user.key().as_ref()],
        has_one = vault,
        has_one = user,
        bump = user_position.bump,
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

impl<'info> CancelWithdraw<'info> {
    fn transfer_shares_to_user(&self, shares_amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.escrow_share_token_account.to_account_info(),
                    mint: self.share_mint.to_account_info(),
                    to: self.user_share_token_account.to_account_info(),
                    authority: self.withdraw_ticket.to_account_info(),
                },
                signer_seeds,
            ),
            shares_amount,
            self.share_mint.decimals,
        )
    }

    fn close_escrow_share_token_account(&self, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::close_account(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                CloseAccount {
                    account: self.escrow_share_token_account.to_account_info(),
                    destination: self.user.to_account_info(),
                    authority: self.withdraw_ticket.to_account_info(),
                },
                signer_seeds,
            )
        )
    }
}

pub fn handler(ctx: Context<CancelWithdraw>) -> Result<()> {
    require_eq!(
        ctx.accounts.withdraw_ticket.ticket_index,
        ctx.accounts.vault.next_ticket_to_process,
        VaultError::TicketOutOfOrder
    );

    let ticket_shares = ctx.accounts.withdraw_ticket.shares;

    let vault_key = ctx.accounts.vault.key();
    let user_key = ctx.accounts.user.key();
    let ticket_index_bytes = ctx.accounts.withdraw_ticket.ticket_index.to_le_bytes();
    let ticket_bump = [ctx.accounts.withdraw_ticket.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[
        WITHDRAW_TICKET_SEED,
        vault_key.as_ref(),
        user_key.as_ref(),
        ticket_index_bytes.as_ref(),
        &ticket_bump,
    ]];

    ctx.accounts
        .transfer_shares_to_user(ticket_shares, signer_seeds)?;

    ctx.accounts
        .close_escrow_share_token_account(signer_seeds)?;

    ctx.accounts.user_position.pending_ticket_count = ctx
        .accounts
        .user_position
        .pending_ticket_count
        .checked_sub(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    ctx.accounts.vault.next_ticket_to_process = ctx
        .accounts
        .vault
        .next_ticket_to_process
        .checked_add(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    Ok(())
}
