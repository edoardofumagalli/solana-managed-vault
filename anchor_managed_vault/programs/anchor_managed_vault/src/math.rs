use anchor_lang::prelude::*;

use crate::{
    constants::{BPS_DENOMINATOR, MAX_FLOAT_BPS, VIRTUAL_ASSETS, VIRTUAL_SHARES},
    errors::VaultError,
};

/// Returns the vault's total managed assets.
///
/// This includes both liquid assets still held by the vault token account and
/// assets temporarily held outside the vault as manager float.
pub fn total_assets(vault_balance: u64, float_outstanding: u64) -> Result<u64> {
    vault_balance
        .checked_add(float_outstanding)
        .ok_or_else(|| error!(VaultError::MathOverflow))
}

/// Converts an asset amount into vault shares, rounding down.
///
/// Formula:
/// shares = assets * (total_shares + VIRTUAL_SHARES)
///        / (total_assets + VIRTUAL_ASSETS)
///
/// The virtual offset keeps the initial price near 1:1 while reducing the
/// impact of first-depositor donation/inflation attacks.
pub fn assets_to_shares_down(assets: u64, total_assets: u64, total_shares: u64) -> Result<u64> {
    require!(assets > 0, VaultError::InvalidAmount);

    let adjusted_total_shares = (total_shares as u128)
        .checked_add(VIRTUAL_SHARES as u128)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let adjusted_total_assets = (total_assets as u128)
        .checked_add(VIRTUAL_ASSETS as u128)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let shares = (assets as u128)
        .checked_mul(adjusted_total_shares)
        .ok_or_else(|| error!(VaultError::MathOverflow))?
        .checked_div(adjusted_total_assets)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let shares = u64::try_from(shares).map_err(|_| error!(VaultError::MathOverflow))?;

    require!(shares > 0, VaultError::ZeroShares);

    Ok(shares)
}

/// Converts a share amount into assets, rounding down.
///
/// Formula:
/// assets = shares * (total_assets + VIRTUAL_ASSETS)
///        / (total_shares + VIRTUAL_SHARES)
///
/// This is used when a withdrawal is processed, so the user exits at the share
/// price observed at processing time rather than request time.
pub fn shares_to_assets_down(shares: u64, total_assets: u64, total_shares: u64) -> Result<u64> {
    require!(shares > 0, VaultError::InvalidAmount);

    let adjusted_total_shares = (total_shares as u128)
        .checked_add(VIRTUAL_SHARES as u128)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let adjusted_total_assets = (total_assets as u128)
        .checked_add(VIRTUAL_ASSETS as u128)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let assets = (shares as u128)
        .checked_mul(adjusted_total_assets)
        .ok_or_else(|| error!(VaultError::MathOverflow))?
        .checked_div(adjusted_total_shares)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    let assets = u64::try_from(assets).map_err(|_| error!(VaultError::MathOverflow))?;

    require!(assets > 0, VaultError::ZeroAssets);

    Ok(assets)
}

/// Verifies that the manager float remains within the vault-specific cap.
///
/// Formula:
/// max_float = total_assets * max_float_bps / BPS_DENOMINATOR
///
/// `MAX_FLOAT_BPS` is only the global upper bound for configuration. The
/// `max_float_bps` argument is the actual cap configured on this vault.
pub fn checked_float_cap(
    total_assets: u64,
    post_float_outstanding: u64,
    max_float_bps: u16,
) -> Result<()> {
    require!(
        max_float_bps <= MAX_FLOAT_BPS,
        VaultError::InvalidMaxFloatBps
    );

    let max_float = (total_assets as u128)
        .checked_mul(max_float_bps as u128)
        .ok_or_else(|| error!(VaultError::MathOverflow))?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    require!(
        post_float_outstanding as u128 <= max_float,
        VaultError::FloatCapExceeded
    );

    Ok(())
}
