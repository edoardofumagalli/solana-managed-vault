use anchor_lang::prelude::*;

#[error_code]
pub enum KaminoYieldModuleError {
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

    #[msg("Module state is not initialized.")]
    NotInitialized,

    #[msg("Invalid NAV value.")]
    InvalidNavValue,

    #[msg("Math overflow.")]
    MathOverflow,
}
