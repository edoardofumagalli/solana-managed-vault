use anchor_lang::prelude::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{MAX_FLOAT_BPS, SHARE_MINT_SEED, VAULT_SEED},
    errors::VaultError,
    state::Vault,
};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    // The manager must sign because this wallet authorizes vault creation.
    // It is mutable because it pays rent for the accounts initialized here.
    #[account(mut)]
    pub manager: Signer<'info>,

    // Token mint accepted as the vault underlying asset. InterfaceAccount keeps
    // this compatible with both classic SPL Token and Token-2022 mints.
    #[account(
        mint::token_program = token_program,
    )]
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    // Main vault state account. It is a PDA controlled by this program and
    // stores configuration plus accounting counters for this underlying mint.
    #[account(
        init,
        space = 8 + Vault::INIT_SPACE,
        payer = manager,
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    // SPL mint for vault shares. The vault PDA is the mint authority, so only
    // this program can mint shares through PDA signing.
    #[account(
        init,
        payer = manager,
        mint::decimals = underlying_mint.decimals,
        mint::authority = vault,
        mint::token_program = token_program,
        seeds = [SHARE_MINT_SEED, vault.key().as_ref()],
        bump,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    // Associated token account that holds the vault's liquid underlying assets.
    // The vault PDA owns this token account, not the manager.
    #[account(
        init,
        payer = manager,
        associated_token::mint = underlying_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    // Token program that owns and operates on the mint above. Interface allows
    // either the classic SPL Token program or the Token-2022 program.
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<InitializeVault>, max_float_bps: u16) -> Result<()> {
    require!(
        max_float_bps <= MAX_FLOAT_BPS,
        VaultError::InvalidMaxFloatBps
    );

    let vault = &mut ctx.accounts.vault;

    vault.manager = ctx.accounts.manager.key();
    // No manager transfer is pending at initialization; default Pubkey is our sentinel.
    vault.pending_manager = Pubkey::default();
    vault.underlying_mint = ctx.accounts.underlying_mint.key();
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.vault_token_account = ctx.accounts.vault_token_account.key();
    vault.float_outstanding = 0;
    vault.max_float_bps = max_float_bps;
    vault.total_tickets = 0;
    vault.next_ticket_to_process = 0;
    vault.bump = ctx.bumps.vault;

    Ok(())
}
