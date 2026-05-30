use anchor_lang::{
    prelude::*,
    solana_program::program::{invoke, invoke_signed},
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use klend_interface::instructions::{
    refresh::{self, RefreshReserveAccounts},
    withdraw::{self, RedeemReserveCollateralAccounts},
};

use crate::{
    constants::{
        KAMINO_MODULE_STATE_SEED, KLEND_PROGRAM_ID, MODULE_CALL_AUTHORITY_SEED, MODULE_CONFIG_SEED,
    },
    errors::KaminoYieldModuleError,
    events::KaminoModuleWithdrawnEvent,
    state::{KaminoModuleState, KaminoModuleType, ModuleConfig},
    utils::{
        calculate_collateral_to_redeem_up, calculate_token_nav, optional_klend_account,
        read_exchange_rate_components, read_reserve_oracle_accounts,
    },
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Non-custodial PDA signer passed by the vault program CPI. This proves
    /// that the call originated from the expected vault program without giving
    /// the module signer power over vault custody accounts.
    pub module_call_authority: Signer<'info>,

    #[account(
        seeds = [MODULE_CONFIG_SEED, module_config.vault.as_ref()],
        bump = module_config.bump,
        constraint = module_config.vault == kamino_module_state.vault
            @ KaminoYieldModuleError::InvalidVault,
        constraint = module_config.vault_program_id == kamino_module_state.vault_program_id
            @ KaminoYieldModuleError::InvalidVaultProgram,
        constraint = module_config.kamino_reserve == kamino_module_state.kamino_reserve
            @ KaminoYieldModuleError::InvalidReserve,
        constraint = module_config.lending_market == kamino_module_state.lending_market
            @ KaminoYieldModuleError::InvalidLendingMarket,
    )]
    pub module_config: Account<'info, ModuleConfig>,

    #[account(
        mut,
        seeds = [KAMINO_MODULE_STATE_SEED, kamino_module_state.vault.as_ref()],
        bump = kamino_module_state.bump,
        constraint = kamino_module_state.is_initialized @ KaminoYieldModuleError::NotInitialized,
    )]
    pub kamino_module_state: Account<'info, KaminoModuleState>,

    /// CHECK: The Kamino/Klend lending market account is owner-checked and matched to module state.
    #[account(
        owner = KLEND_PROGRAM_ID @ KaminoYieldModuleError::InvalidLendingMarket,
        constraint = lending_market.key() == kamino_module_state.lending_market
            @ KaminoYieldModuleError::InvalidLendingMarket,
    )]
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: The Kamino/Klend reserve account is owner-checked and matched to module state.
    #[account(
        mut,
        owner = KLEND_PROGRAM_ID @ KaminoYieldModuleError::InvalidReserve,
        constraint = kamino_reserve.key() == kamino_module_state.kamino_reserve
            @ KaminoYieldModuleError::InvalidReserve,
    )]
    pub kamino_reserve: UncheckedAccount<'info>,

    /// CHECK: Klend validates that this is the correct lending market authority PDA.
    pub lending_market_authority: UncheckedAccount<'info>,

    /// CHECK: Optional price oracle used by Klend refresh_reserve.
    pub pyth_oracle: UncheckedAccount<'info>,

    /// CHECK: Optional Switchboard price oracle used by Klend refresh_reserve.
    pub switchboard_price_oracle: UncheckedAccount<'info>,

    /// CHECK: Optional Switchboard TWAP oracle used by Klend refresh_reserve.
    pub switchboard_twap_oracle: UncheckedAccount<'info>,

    /// CHECK: Optional Scope prices account used by Klend refresh_reserve.
    pub scope_prices: UncheckedAccount<'info>,

    #[account(
        mint::token_program = liquidity_token_program,
    )]
    pub reserve_liquidity_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        mint::token_program = token_program,
    )]
    pub reserve_collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = reserve_liquidity_mint,
        token::token_program = liquidity_token_program,
    )]
    pub reserve_liquidity_supply: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = reserve_collateral_mint,
        token::authority = kamino_module_state,
        token::token_program = token_program,
        constraint = vault_collateral_account.owner == kamino_module_state.key()
            @ KaminoYieldModuleError::InvalidCollateralAccount,
    )]
    pub vault_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = reserve_liquidity_mint,
        token::token_program = liquidity_token_program,
        constraint = vault_token_account.owner == kamino_module_state.vault
            @ KaminoYieldModuleError::InvalidTokenAccount,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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

impl<'info> Withdraw<'info> {
    fn refresh_reserve(&self) -> Result<()> {
        let reserve_data = self.kamino_reserve.try_borrow_data()?;
        let oracle_accounts =
            read_reserve_oracle_accounts(self.kamino_reserve.key(), &reserve_data)?;
        drop(reserve_data);

        let refresh_ix = refresh::refresh_reserve(RefreshReserveAccounts {
            reserve: self.kamino_reserve.key(),
            lending_market: self.lending_market.key(),
            pyth_oracle: optional_klend_account(
                oracle_accounts.pyth_oracle,
                self.pyth_oracle.key(),
            )?,
            switchboard_price_oracle: optional_klend_account(
                oracle_accounts.switchboard_price_oracle,
                self.switchboard_price_oracle.key(),
            )?,
            switchboard_twap_oracle: optional_klend_account(
                oracle_accounts.switchboard_twap_oracle,
                self.switchboard_twap_oracle.key(),
            )?,
            scope_prices: optional_klend_account(
                oracle_accounts.scope_prices,
                self.scope_prices.key(),
            )?,
        });

        invoke(
            &refresh_ix,
            &[
                self.kamino_reserve.to_account_info(),
                self.lending_market.to_account_info(),
                self.pyth_oracle.to_account_info(),
                self.switchboard_price_oracle.to_account_info(),
                self.switchboard_twap_oracle.to_account_info(),
                self.scope_prices.to_account_info(),
                self.klend_program.to_account_info(),
            ],
        )?;

        Ok(())
    }
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, KaminoYieldModuleError::InvalidAmount);

    let (expected_module_call_authority, _) = Pubkey::find_program_address(
        &[
            MODULE_CALL_AUTHORITY_SEED,
            ctx.accounts.kamino_module_state.vault.as_ref(),
        ],
        &ctx.accounts.kamino_module_state.vault_program_id,
    );
    require_keys_eq!(
        ctx.accounts.module_call_authority.key(),
        expected_module_call_authority,
        KaminoYieldModuleError::UnauthorizedVault
    );

    require!(
        ctx.accounts.kamino_module_state.kamino_module_type()? == KaminoModuleType::Token,
        KaminoYieldModuleError::UnsupportedWithdrawMode
    );

    ctx.accounts.refresh_reserve()?;

    let reserve_data = ctx.accounts.kamino_reserve.try_borrow_data()?;
    let (total_liquidity, collateral_supply) = read_exchange_rate_components(&reserve_data)?;
    let collateral_amount =
        calculate_collateral_to_redeem_up(amount, total_liquidity, collateral_supply)?;
    drop(reserve_data);

    require!(
        ctx.accounts.vault_collateral_account.amount >= collateral_amount,
        KaminoYieldModuleError::InsufficientCollateral
    );

    let vault_token_balance_before = ctx.accounts.vault_token_account.amount;
    let vault_key = ctx.accounts.kamino_module_state.vault;
    let module_state_bump = [ctx.accounts.kamino_module_state.bump];
    let module_state_signer_seeds: &[&[&[u8]]] = &[&[
        KAMINO_MODULE_STATE_SEED,
        vault_key.as_ref(),
        &module_state_bump,
    ]];

    let redeem_ix = withdraw::redeem_reserve_collateral(
        RedeemReserveCollateralAccounts {
            owner: ctx.accounts.kamino_module_state.key(),
            lending_market: ctx.accounts.lending_market.key(),
            reserve: ctx.accounts.kamino_reserve.key(),
            lending_market_authority: ctx.accounts.lending_market_authority.key(),
            reserve_liquidity_mint: ctx.accounts.reserve_liquidity_mint.key(),
            reserve_collateral_mint: ctx.accounts.reserve_collateral_mint.key(),
            reserve_liquidity_supply: ctx.accounts.reserve_liquidity_supply.key(),
            user_source_collateral: ctx.accounts.vault_collateral_account.key(),
            user_destination_liquidity: ctx.accounts.vault_token_account.key(),
            liquidity_token_program: ctx.accounts.liquidity_token_program.key(),
        },
        collateral_amount,
    );

    invoke_signed(
        &redeem_ix,
        &[
            ctx.accounts.kamino_module_state.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.kamino_reserve.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.reserve_liquidity_mint.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts.vault_collateral_account.to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.liquidity_token_program.to_account_info(),
            ctx.accounts.klend_program.to_account_info(),
            ctx.accounts.instruction_sysvar.to_account_info(),
        ],
        module_state_signer_seeds,
    )?;

    ctx.accounts.vault_collateral_account.reload()?;
    ctx.accounts.vault_token_account.reload()?;

    let returned_amount = ctx
        .accounts
        .vault_token_account
        .amount
        .checked_sub(vault_token_balance_before)
        .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?;
    require!(
        returned_amount >= amount,
        KaminoYieldModuleError::InsufficientReturnedLiquidity
    );

    let clock = Clock::get()?;
    let cached_nav = if ctx.accounts.vault_collateral_account.amount == 0 {
        0
    } else {
        let reserve_data = ctx.accounts.kamino_reserve.try_borrow_data()?;
        let (total_liquidity, collateral_supply) = read_exchange_rate_components(&reserve_data)?;
        calculate_token_nav(
            ctx.accounts.vault_collateral_account.amount,
            total_liquidity,
            collateral_supply,
        )?
    };

    ctx.accounts.kamino_module_state.cached_nav = cached_nav;
    ctx.accounts.kamino_module_state.last_updated_slot = clock.slot;

    emit!(KaminoModuleWithdrawnEvent {
        vault: vault_key,
        module_state: ctx.accounts.kamino_module_state.key(),
        kamino_reserve: ctx.accounts.kamino_reserve.key(),
        vault_collateral_account: ctx.accounts.vault_collateral_account.key(),
        vault_token_account: ctx.accounts.vault_token_account.key(),
        requested_amount: amount,
        collateral_amount,
        returned_amount,
        cached_nav,
        slot: clock.slot,
    });

    Ok(())
}
