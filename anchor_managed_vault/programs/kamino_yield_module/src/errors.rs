use anchor_lang::prelude::*;

#[error_code]
pub enum KaminoYieldModuleError {
    #[msg("Invalid amount.")]
    InvalidAmount,

    #[msg("Invalid module type.")]
    InvalidModuleType,

    #[msg("Invalid vault.")]
    InvalidVault,

    #[msg("Invalid Kamino reserve.")]
    InvalidReserve,

    #[msg("Invalid lending market.")]
    InvalidLendingMarket,

    #[msg("Invalid obligation account.")]
    InvalidObligation,

    #[msg("Invalid module token account.")]
    InvalidTokenAccount,

    #[msg("Invalid collateral token account.")]
    InvalidCollateralAccount,

    #[msg("Deposit is only supported for token-mode modules for now.")]
    UnsupportedDepositMode,

    #[msg("Module token account does not have enough liquidity.")]
    InsufficientLiquidity,

    #[msg("Module state is not initialized.")]
    NotInitialized,

    #[msg("Invalid NAV value.")]
    InvalidNavValue,

    #[msg("Math overflow.")]
    MathOverflow,
}
