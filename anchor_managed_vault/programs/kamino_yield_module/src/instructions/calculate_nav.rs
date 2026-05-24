use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::{KAMINO_MODULE_STATE_SEED, KLEND_PROGRAM_ID},
    errors::KaminoYieldModuleError,
    state::{KaminoModuleState, KaminoModuleType},
    utils::{
        calculate_token_nav, read_exchange_rate_components, read_obligation_deposit_for_reserve,
    },
};

#[derive(Accounts)]
pub struct CalculateNav<'info> {
    pub payer: Signer<'info>,

    /// CHECK: Used to derive and validate the Kamino module state PDA.
    pub vault: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [KAMINO_MODULE_STATE_SEED, vault.key().as_ref()],
        bump = kamino_module_state.bump,
        constraint = kamino_module_state.is_initialized @ KaminoYieldModuleError::NotInitialized,
        constraint = kamino_module_state.vault == vault.key() @ KaminoYieldModuleError::InvalidVault,
    )]
    pub kamino_module_state: Account<'info, KaminoModuleState>,

    /// CHECK: The Kamino/Klend reserve account is owner-checked and read as raw bytes.
    #[account(
        owner = KLEND_PROGRAM_ID @ KaminoYieldModuleError::InvalidReserve,
        constraint = kamino_reserve.key() == kamino_module_state.kamino_reserve
            @ KaminoYieldModuleError::InvalidReserve,
    )]
    pub kamino_reserve: UncheckedAccount<'info>,

    pub vault_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Only used for obligation-based modules. Token-based modules ignore it.
    pub obligation: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CalculateNav>) -> Result<()> {
    let module_type = ctx.accounts.kamino_module_state.kamino_module_type()?;

    let position_amount = match module_type {
        KaminoModuleType::Token => ctx.accounts.vault_collateral_account.amount,
        KaminoModuleType::Obligation => {
            require!(
                ctx.accounts.obligation.key() == ctx.accounts.kamino_module_state.obligation,
                KaminoYieldModuleError::InvalidObligation
            );
            require_keys_eq!(
                *ctx.accounts.obligation.owner,
                KLEND_PROGRAM_ID,
                KaminoYieldModuleError::InvalidObligation
            );

            let obligation_data = ctx.accounts.obligation.try_borrow_data()?;
            read_obligation_deposit_for_reserve(
                &obligation_data,
                &ctx.accounts.kamino_module_state.kamino_reserve,
            )?
        }
    };

    let clock = Clock::get()?;

    if position_amount == 0 {
        ctx.accounts.kamino_module_state.cached_nav = 0;
        ctx.accounts.kamino_module_state.last_updated_slot = clock.slot;

        return Ok(());
    }

    let reserve_data = ctx.accounts.kamino_reserve.try_borrow_data()?;
    let (total_liquidity, collateral_supply) = read_exchange_rate_components(&reserve_data)?;
    let nav = calculate_token_nav(position_amount, total_liquidity, collateral_supply)?;

    ctx.accounts.kamino_module_state.cached_nav = nav;
    ctx.accounts.kamino_module_state.last_updated_slot = clock.slot;

    Ok(())
}
