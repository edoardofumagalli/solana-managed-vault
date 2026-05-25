use anchor_lang::prelude::*;

use crate::errors::KaminoYieldModuleError;

const FRAC_BITS: u32 = 60;

const RESERVE_LIQUIDITY_OFFSET: usize = 128;
const LIQUIDITY_AVAILABLE_AMOUNT_OFFSET: usize = 96;
const LIQUIDITY_BORROWED_AMOUNT_SF_OFFSET: usize = 104;
const LIQUIDITY_ACCUMULATED_PROTOCOL_FEES_SF_OFFSET: usize = 216;
const LIQUIDITY_ACCUMULATED_REFERRER_FEES_SF_OFFSET: usize = 232;
const LIQUIDITY_PENDING_REFERRER_FEES_SF_OFFSET: usize = 248;

const RESERVE_COLLATERAL_OFFSET: usize = 2560;
const COLLATERAL_MINT_TOTAL_SUPPLY_OFFSET: usize = 32;
const MIN_RESERVE_LEN: usize = RESERVE_COLLATERAL_OFFSET + COLLATERAL_MINT_TOTAL_SUPPLY_OFFSET + 8;

const OBLIGATION_DEPOSITS_OFFSET: usize = 96;
const OBLIGATION_COLLATERAL_SIZE: usize = 88;
const OBLIGATION_COLLATERAL_DEPOSITED_AMOUNT_OFFSET: usize = 32;
const MAX_OBLIGATION_DEPOSITS: usize = 8;
const MIN_OBLIGATION_LEN: usize =
    OBLIGATION_DEPOSITS_OFFSET + (MAX_OBLIGATION_DEPOSITS * OBLIGATION_COLLATERAL_SIZE);

/// Reads the minimum Kamino reserve fields needed to price collateral tokens.
pub fn read_exchange_rate_components(reserve_data: &[u8]) -> Result<(u128, u128)> {
    require!(
        reserve_data.len() >= MIN_RESERVE_LEN,
        KaminoYieldModuleError::InvalidReserve
    );

    let available = read_u64(
        reserve_data,
        RESERVE_LIQUIDITY_OFFSET + LIQUIDITY_AVAILABLE_AMOUNT_OFFSET,
    )? as u128;
    let borrowed = read_fractional_u128(
        reserve_data,
        RESERVE_LIQUIDITY_OFFSET + LIQUIDITY_BORROWED_AMOUNT_SF_OFFSET,
    )?;
    let protocol_fees = read_fractional_u128(
        reserve_data,
        RESERVE_LIQUIDITY_OFFSET + LIQUIDITY_ACCUMULATED_PROTOCOL_FEES_SF_OFFSET,
    )?;
    let referrer_fees = read_fractional_u128(
        reserve_data,
        RESERVE_LIQUIDITY_OFFSET + LIQUIDITY_ACCUMULATED_REFERRER_FEES_SF_OFFSET,
    )?;
    let pending_fees = read_fractional_u128(
        reserve_data,
        RESERVE_LIQUIDITY_OFFSET + LIQUIDITY_PENDING_REFERRER_FEES_SF_OFFSET,
    )?;
    let collateral_supply = read_u64(
        reserve_data,
        RESERVE_COLLATERAL_OFFSET + COLLATERAL_MINT_TOTAL_SUPPLY_OFFSET,
    )? as u128;

    let total_fees = protocol_fees
        .checked_add(referrer_fees)
        .and_then(|value| value.checked_add(pending_fees))
        .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?;
    let gross_liquidity = available
        .checked_add(borrowed)
        .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?;
    let total_liquidity = gross_liquidity
        .checked_sub(total_fees)
        .ok_or_else(|| error!(KaminoYieldModuleError::InvalidNavValue))?;

    Ok((total_liquidity, collateral_supply))
}

/// Reads the deposited collateral amount for a reserve from a Kamino obligation.
pub fn read_obligation_deposit_for_reserve(
    obligation_data: &[u8],
    reserve_key: &Pubkey,
) -> Result<u64> {
    require!(
        obligation_data.len() >= MIN_OBLIGATION_LEN,
        KaminoYieldModuleError::InvalidObligation
    );

    for i in 0..MAX_OBLIGATION_DEPOSITS {
        let deposit_offset = OBLIGATION_DEPOSITS_OFFSET + (i * OBLIGATION_COLLATERAL_SIZE);
        let reserve_bytes = obligation_data
            .get(deposit_offset..deposit_offset + 32)
            .ok_or_else(|| error!(KaminoYieldModuleError::InvalidObligation))?;

        if reserve_bytes == &[0_u8; 32] {
            break;
        }

        if reserve_bytes == reserve_key.as_ref() {
            let amount_offset = deposit_offset + OBLIGATION_COLLATERAL_DEPOSITED_AMOUNT_OFFSET;
            let amount_bytes = obligation_data
                .get(amount_offset..amount_offset + 8)
                .ok_or_else(|| error!(KaminoYieldModuleError::InvalidObligation))?;

            return Ok(u64::from_le_bytes(amount_bytes.try_into().map_err(|_| {
                error!(KaminoYieldModuleError::InvalidObligation)
            })?));
        }
    }

    Ok(0)
}

/// Converts a collateral-token position into underlying value using the reserve exchange rate.
pub fn calculate_token_nav(
    position_amount: u64,
    total_liquidity: u128,
    collateral_supply: u128,
) -> Result<u64> {
    require!(
        collateral_supply > 0,
        KaminoYieldModuleError::InvalidNavValue
    );

    let nav = (position_amount as u128)
        .checked_mul(total_liquidity)
        .and_then(|value| value.checked_div(collateral_supply))
        .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?;

    u64::try_from(nav).map_err(|_| error!(KaminoYieldModuleError::MathOverflow))
}

/// Converts a requested underlying amount into the collateral amount to redeem.
/// Rounds up so the Klend redeem should return at least the requested liquidity
/// when the reserve has enough liquidity available.
pub fn calculate_collateral_to_redeem_up(
    requested_underlying_amount: u64,
    total_liquidity: u128,
    collateral_supply: u128,
) -> Result<u64> {
    require!(
        total_liquidity > 0 && collateral_supply > 0,
        KaminoYieldModuleError::InvalidNavValue
    );

    let numerator = (requested_underlying_amount as u128)
        .checked_mul(collateral_supply)
        .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?;
    let quotient = numerator
        .checked_div(total_liquidity)
        .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?;
    let remainder = numerator
        .checked_rem(total_liquidity)
        .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?;

    let collateral_amount = if remainder == 0 {
        quotient
    } else {
        quotient
            .checked_add(1)
            .ok_or_else(|| error!(KaminoYieldModuleError::MathOverflow))?
    };

    u64::try_from(collateral_amount).map_err(|_| error!(KaminoYieldModuleError::MathOverflow))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or_else(|| error!(KaminoYieldModuleError::InvalidReserve))?;

    Ok(u64::from_le_bytes(bytes.try_into().map_err(|_| {
        error!(KaminoYieldModuleError::InvalidReserve)
    })?))
}

fn read_fractional_u128(data: &[u8], offset: usize) -> Result<u128> {
    let bytes = data
        .get(offset..offset + 16)
        .ok_or_else(|| error!(KaminoYieldModuleError::InvalidReserve))?;
    let raw = u128::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| error!(KaminoYieldModuleError::InvalidReserve))?,
    );

    Ok(raw >> FRAC_BITS)
}
