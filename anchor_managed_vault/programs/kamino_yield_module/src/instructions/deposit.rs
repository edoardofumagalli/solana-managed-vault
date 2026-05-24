use anchor_lang::{prelude::*, solana_program::program::invoke_signed};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use klend_interface::instructions::deposit::{self, DepositReserveLiquidityAccounts};

use crate::{
    constants::{KAMINO_MODULE_STATE_SEED, KLEND_PROGRAM_ID, MODULE_CONFIG_SEED},
    errors::KaminoYieldModuleError,
    events::KaminoModuleDepositedEvent,
    state::{KaminoModuleState, KaminoModuleType, ModuleConfig},
    utils::{calculate_token_nav, read_exchange_rate_components},
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// Vault PDA signer passed by the vault program CPI. This makes deposit a
    /// vault-authenticated module action instead of a direct manager action.
    pub vault_authority: Signer<'info>,

    #[account(
        seeds = [MODULE_CONFIG_SEED, vault_authority.key().as_ref()],
        bump = module_config.bump,
        constraint = module_config.vault == vault_authority.key() @ KaminoYieldModuleError::InvalidVault,
        constraint = module_config.kamino_reserve == kamino_module_state.kamino_reserve
            @ KaminoYieldModuleError::InvalidReserve,
        constraint = module_config.lending_market == kamino_module_state.lending_market
            @ KaminoYieldModuleError::InvalidLendingMarket,
    )]
    pub module_config: Account<'info, ModuleConfig>,

    #[account(
        mut,
        seeds = [KAMINO_MODULE_STATE_SEED, vault_authority.key().as_ref()],
        bump = kamino_module_state.bump,
        constraint = kamino_module_state.is_initialized @ KaminoYieldModuleError::NotInitialized,
        constraint = kamino_module_state.vault == vault_authority.key() @ KaminoYieldModuleError::InvalidVault,
    )]
    pub kamino_module_state: Account<'info, KaminoModuleState>,

    /// CHECK: The Kamino/Klend reserve account is owner-checked and matched to module state.
    #[account(
        mut,
        owner = KLEND_PROGRAM_ID @ KaminoYieldModuleError::InvalidReserve,
        constraint = kamino_reserve.key() == kamino_module_state.kamino_reserve
            @ KaminoYieldModuleError::InvalidReserve,
    )]
    pub kamino_reserve: UncheckedAccount<'info>,

    /// CHECK: The Kamino/Klend lending market account is owner-checked and matched to module state.
    #[account(
        owner = KLEND_PROGRAM_ID @ KaminoYieldModuleError::InvalidLendingMarket,
        constraint = lending_market.key() == kamino_module_state.lending_market
            @ KaminoYieldModuleError::InvalidLendingMarket,
    )]
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: Klend validates that this is the correct lending market authority PDA.
    pub lending_market_authority: UncheckedAccount<'info>,

    #[account(
        mint::token_program = liquidity_token_program,
    )]
    pub reserve_liquidity_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = reserve_liquidity_mint,
        token::token_program = liquidity_token_program,
    )]
    pub reserve_liquidity_supply: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        mint::token_program = token_program,
    )]
    pub reserve_collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = reserve_liquidity_mint,
        token::authority = kamino_module_state,
        token::token_program = liquidity_token_program,
        constraint = module_underlying_token_account.mint == reserve_liquidity_mint.key()
            @ KaminoYieldModuleError::InvalidTokenAccount,
        constraint = module_underlying_token_account.owner == kamino_module_state.key()
            @ KaminoYieldModuleError::InvalidTokenAccount,
    )]
    pub module_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = reserve_collateral_mint,
        token::authority = kamino_module_state,
        token::token_program = token_program,
        constraint = vault_collateral_account.mint == reserve_collateral_mint.key()
            @ KaminoYieldModuleError::InvalidCollateralAccount,
        constraint = vault_collateral_account.owner == kamino_module_state.key()
            @ KaminoYieldModuleError::InvalidCollateralAccount,
    )]
    pub vault_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = anchor_spl::token::ID)]
    pub token_program: Interface<'info, TokenInterface>,

    #[account(address = anchor_spl::token::ID)]
    pub liquidity_token_program: Interface<'info, TokenInterface>,

    /// CHECK: The Kamino lending program.
    #[account(address = KLEND_PROGRAM_ID)]
    pub klend_program: UncheckedAccount<'info>,

    /// CHECK: Klend requires the instructions sysvar for this CPI.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, KaminoYieldModuleError::InvalidAmount);
    require!(
        ctx.accounts.kamino_module_state.kamino_module_type()? == KaminoModuleType::Token,
        KaminoYieldModuleError::UnsupportedDepositMode
    );
    require!(
        ctx.accounts.module_underlying_token_account.amount >= amount,
        KaminoYieldModuleError::InsufficientLiquidity
    );

    let vault_key = ctx.accounts.vault_authority.key();
    let module_state_bump = [ctx.accounts.kamino_module_state.bump];
    let module_state_signer_seeds: &[&[&[u8]]] = &[&[
        KAMINO_MODULE_STATE_SEED,
        vault_key.as_ref(),
        &module_state_bump,
    ]];

    let deposit_ix = deposit::deposit_reserve_liquidity(
        DepositReserveLiquidityAccounts {
            owner: ctx.accounts.kamino_module_state.key(),
            reserve: ctx.accounts.kamino_reserve.key(),
            lending_market: ctx.accounts.lending_market.key(),
            lending_market_authority: ctx.accounts.lending_market_authority.key(),
            reserve_liquidity_mint: ctx.accounts.reserve_liquidity_mint.key(),
            reserve_liquidity_supply: ctx.accounts.reserve_liquidity_supply.key(),
            reserve_collateral_mint: ctx.accounts.reserve_collateral_mint.key(),
            user_source_liquidity: ctx.accounts.module_underlying_token_account.key(),
            user_destination_collateral: ctx.accounts.vault_collateral_account.key(),
            liquidity_token_program: ctx.accounts.liquidity_token_program.key(),
        },
        amount,
    );

    invoke_signed(
        &deposit_ix,
        &[
            ctx.accounts.kamino_module_state.to_account_info(),
            ctx.accounts.kamino_reserve.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.reserve_liquidity_mint.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts
                .module_underlying_token_account
                .to_account_info(),
            ctx.accounts.vault_collateral_account.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.liquidity_token_program.to_account_info(),
            ctx.accounts.klend_program.to_account_info(),
            ctx.accounts.instruction_sysvar.to_account_info(),
        ],
        module_state_signer_seeds,
    )?;

    ctx.accounts.vault_collateral_account.reload()?;

    let reserve_data = ctx.accounts.kamino_reserve.try_borrow_data()?;
    let (total_liquidity, collateral_supply) = read_exchange_rate_components(&reserve_data)?;
    let cached_nav = calculate_token_nav(
        ctx.accounts.vault_collateral_account.amount,
        total_liquidity,
        collateral_supply,
    )?;
    drop(reserve_data);

    let clock = Clock::get()?;
    ctx.accounts.kamino_module_state.cached_nav = cached_nav;
    ctx.accounts.kamino_module_state.last_updated_slot = clock.slot;

    emit!(KaminoModuleDepositedEvent {
        vault: vault_key,
        module_state: ctx.accounts.kamino_module_state.key(),
        kamino_reserve: ctx.accounts.kamino_reserve.key(),
        module_underlying_token_account: ctx.accounts.module_underlying_token_account.key(),
        vault_collateral_account: ctx.accounts.vault_collateral_account.key(),
        amount,
        cached_nav,
        slot: clock.slot,
    });

    Ok(())
}
