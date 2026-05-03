use anchor_lang::prelude::*;

use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::{
        ESCROW_SHARE_SEED, MAX_PENDING_TICKETS_PER_USER, USER_VAULT_POSITION_SEED, VAULT_SEED,
        WITHDRAW_TICKET_SEED,
    },
    errors::VaultError,
    math::{shares_to_assets_down, total_assets},
    state::{UserVaultPosition, Vault, WithdrawTicket},
};

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

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
        mint::authority = vault,
        mint::token_program = token_program,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_share_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        space = 8 + UserVaultPosition::INIT_SPACE,
        payer = user,
        seeds = [USER_VAULT_POSITION_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserVaultPosition>,

    #[account(
        init,
        payer = user,
        space = 8 + WithdrawTicket::INIT_SPACE,
        seeds = [WITHDRAW_TICKET_SEED, vault.key().as_ref(), user.key().as_ref(), vault.total_tickets.to_le_bytes().as_ref()],
        bump,
    )]
    pub withdraw_ticket: Account<'info, WithdrawTicket>,

    #[account(
        init,
        payer = user,
        seeds = [ESCROW_SHARE_SEED, withdraw_ticket.key().as_ref()],
        bump,
        token::mint = share_mint,
        token::authority = withdraw_ticket,
        token::token_program = token_program,
    )]
    pub escrow_share_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> RequestWithdraw<'info> {
    fn transfer_shares_to_escrow(&self, shares_amount: u64) -> Result<()> {
        token_interface::transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.user_share_token_account.to_account_info(),
                    mint: self.share_mint.to_account_info(),
                    to: self.escrow_share_token_account.to_account_info(),
                    authority: self.user.to_account_info(),
                },
            ),
            shares_amount,
            self.share_mint.decimals,
        )
    }
}

pub fn handler(ctx: Context<RequestWithdraw>, shares_amount: u64) -> Result<()> {
    require!(shares_amount > 0, VaultError::InvalidAmount);

    require!(
        ctx.accounts.user_share_token_account.amount >= shares_amount,
        VaultError::InsufficientShares
    );

    require!(
        ctx.accounts.user_position.pending_ticket_count < MAX_PENDING_TICKETS_PER_USER,
        VaultError::TooManyPendingTickets
    );

    let total_assets_now = total_assets(
        ctx.accounts.vault_token_account.amount,
        ctx.accounts.vault.float_outstanding,
    )?;

    // Anti-dust check only: the final withdrawal amount is calculated later
    // in process_withdraw, using the share price at processing time.
    shares_to_assets_down(
        shares_amount,
        total_assets_now,
        ctx.accounts.share_mint.supply,
    )?;

    ctx.accounts.transfer_shares_to_escrow(shares_amount)?;

    let vault_key = ctx.accounts.vault.key();
    let user_key = ctx.accounts.user.key();
    let escrow_key = ctx.accounts.escrow_share_token_account.key();
    let ticket_index = ctx.accounts.vault.total_tickets;
    let requested_slot = Clock::get()?.slot;

    ctx.accounts.withdraw_ticket.set_inner(WithdrawTicket {
        vault: vault_key,
        user: user_key,
        escrow_share_token_account: escrow_key,
        ticket_index,
        shares: shares_amount,
        requested_slot,
        bump: ctx.bumps.withdraw_ticket,
    });

    ctx.accounts.user_position.vault = vault_key;
    ctx.accounts.user_position.user = user_key;
    ctx.accounts.user_position.bump = ctx.bumps.user_position;
    ctx.accounts.user_position.pending_ticket_count = ctx
        .accounts
        .user_position
        .pending_ticket_count
        .checked_add(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    ctx.accounts.vault.total_tickets = ctx
        .accounts
        .vault
        .total_tickets
        .checked_add(1)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    Ok(())
}
