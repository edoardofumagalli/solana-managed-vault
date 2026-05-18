use anchor_lang::prelude::*;

#[error_code]
pub enum MockYieldModuleError {
    #[msg("Invalid amount.")]
    InvalidAmount,

    #[msg("Unauthorized vault authority.")]
    UnauthorizedVault,

    #[msg("Invalid vault.")]
    InvalidVault,

    #[msg("Invalid token account.")]
    InvalidTokenAccount,

    #[msg("Math overflow.")]
    MathOverflow,
}
