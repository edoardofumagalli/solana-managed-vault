// PDA seed used to derive the main vault state account.
// The concrete derivation should include enough context to make each vault unique,
// for example: [VAULT_SEED, underlying_mint.key().as_ref()].
pub const VAULT_SEED: &[u8] = b"vault";

// PDA seed used to derive each withdrawal ticket account.
// A ticket should also include the vault, the user and a monotonic ticket index
// in its seeds so every request has a deterministic, unique address.
pub const WITHDRAW_TICKET_SEED: &[u8] = b"withdraw_ticket";

// PDA seed used to track per-user metadata for a specific vault.
// In this project it is mainly useful to enforce the per-user pending ticket cap.
pub const USER_VAULT_POSITION_SEED: &[u8] = b"user_vault_position";

// PDA seed for the authority/account that escrows share tokens while a withdrawal
// request is pending. The exact account layout will be defined in request_withdraw.
pub const ESCROW_SHARE_SEED: &[u8] = b"escrow_share";

// Basis points denominator: 10_000 bps = 100%.
// Example: 2_500 bps means 25%.
pub const BPS_DENOMINATOR: u64 = 10_000;

// Upper bound for max_float_bps. This prevents configuring a manager float cap
// greater than the vault's total assets.
pub const MAX_FLOAT_BPS: u16 = 10_000;

// Virtual offset used by the ERC-4626-style conversion math.
// Keeping virtual assets and virtual shares equal preserves an initial 1:1 price
// while reducing the impact of first-depositor donation/inflation attacks.
pub const VIRTUAL_ASSETS: u64 = 1_000;
pub const VIRTUAL_SHARES: u64 = 1_000;

// Anti-spam guard for withdrawal requests.
// This is tracked in UserVaultPosition and should be decremented when a ticket
// is processed or cancelled.
pub const MAX_PENDING_TICKETS_PER_USER: u8 = 8;
