use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    // Generic input validation.
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,

    #[msg("Configured max float basis points cannot exceed 100%.")]
    InvalidMaxFloatBps,

    // Math and ERC-4626-style conversion errors.
    #[msg("Arithmetic overflow.")]
    MathOverflow,

    #[msg("Conversion would result in zero shares.")]
    ZeroShares,

    #[msg("Conversion would result in zero assets.")]
    ZeroAssets,

    // Manager float rules.
    #[msg("Manager withdrawal delay exceeds the allowed maximum.")]
    InvalidManagerWithdrawDelay,

    #[msg("Manager withdrawal request timelock has not elapsed yet.")]
    ManagerWithdrawTimelockNotElapsed,

    #[msg("Manager withdrawal request does not match the expected accounts.")]
    InvalidManagerWithdrawRequest,

    #[msg("Manager float cap exceeded.")]
    FloatCapExceeded,

    #[msg("Vault does not have enough liquid assets.")]
    InsufficientLiquidity,

    // Withdrawal queue rules.
    #[msg("Withdrawal ticket is not the next ticket in FIFO order.")]
    TicketOutOfOrder,

    #[msg("User has too many pending withdrawal tickets.")]
    TooManyPendingTickets,

    // Authorization / ownership rules.
    #[msg("Only the current manager can perform this action.")]
    UnauthorizedManager,

    #[msg("Only the ticket owner can perform this action.")]
    UnauthorizedTicketOwner,

    #[msg("Pending manager does not match the expected account.")]
    InvalidPendingManager,

    #[msg("Manager cannot be the default public key.")]
    InvalidManager,

    #[msg("Emergency admin cannot be the default public key.")]
    InvalidEmergencyAdmin,

    // Emergency shutdown rules.
    #[msg("Only the configured emergency admin can perform this action.")]
    UnauthorizedEmergencyAdmin,

    #[msg("Vault emergency shutdown is already active.")]
    ShutdownAlreadyActive,

    #[msg("Vault is in emergency shutdown mode.")]
    VaultShutdown,

    #[msg("User does not have enough shares.")]
    InsufficientShares,
}
