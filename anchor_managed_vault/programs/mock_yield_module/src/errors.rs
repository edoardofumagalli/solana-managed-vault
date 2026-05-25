use anchor_lang::prelude::*;

#[error_code]
pub enum MockYieldModuleError {
    #[msg("Invalid amount.")]
    InvalidAmount,

    #[msg("Unauthorized vault authority.")]
    UnauthorizedVault,

    #[msg("Invalid vault.")]
    InvalidVault,

    #[msg("Invalid vault program.")]
    InvalidVaultProgram,

    #[msg("Invalid token account.")]
    InvalidTokenAccount,

    #[msg("Invalid mint.")]
    InvalidMint,

    #[msg("Module token account does not have enough liquidity.")]
    InsufficientLiquidity,

    #[msg("Math overflow.")]
    MathOverflow,
}
