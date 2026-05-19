// PDA seed used to derive the main vault state account.
// The concrete derivation should include enough context to make each vault unique,
// for example: [VAULT_SEED, underlying_mint.key().as_ref()].
pub const VAULT_SEED: &[u8] = b"vault";

// PDA seed used to derive the SPL mint for vault shares.
// The vault PDA should be the mint authority for this share mint.
pub const SHARE_MINT_SEED: &[u8] = b"share_mint";

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

// PDA seed used to derive pending manager withdrawal requests.
// The derivation should also include the vault and a monotonic request id.
pub const MANAGER_WITHDRAW_REQUEST_SEED: &[u8] = b"manager_withdraw_request";

// PDA seed used to derive per-module accounting entries for a vault.
// Derive with vault, module program id, and policy_seed so one module program
// can register multiple independent strategies for the same vault.
pub const MODULE_ENTRY_SEED: &[u8] = b"module_entry";

// Guardrail for how many external module policies a vault can register.
// The vault stores only an aggregate NAV total, while each ModuleEntry stores
// per-policy module details. Keeping a cap avoids unbounded registration.
pub const MAX_MODULES_PER_VAULT: u8 = 16;

// Standard module-state byte layout read by sync_module_nav.
// Anchor account data starts with an 8-byte discriminator, then the module
// header must store: bump (1), vault Pubkey (32), cached_nav u64 (8).
pub const MODULE_VAULT_OFFSET: usize = 9;
pub const MODULE_NAV_OFFSET: usize = 41;
pub const MODULE_NAV_END: usize = 49;

// Basis points denominator: 10_000 bps = 100%.
// Example: 2_500 bps means 25%.
pub const BPS_DENOMINATOR: u64 = 10_000;

// Upper bound for max_float_bps. This prevents configuring a manager float cap
// greater than the vault's total assets.
pub const MAX_FLOAT_BPS: u16 = 10_000;

// Upper bound for the manager withdrawal timelock delay.
// This is a guardrail against accidentally configuring an unreachable delay.
pub const MAX_MANAGER_WITHDRAW_DELAY_SLOTS: u64 = 432_000;

// Virtual offset used by the ERC-4626-style conversion math.
// Keeping virtual assets and virtual shares equal preserves an initial 1:1 price
// while reducing the impact of first-depositor donation/inflation attacks.
pub const VIRTUAL_ASSETS: u64 = 1_000;
pub const VIRTUAL_SHARES: u64 = 1_000;

// Anti-spam guard for withdrawal requests.
// This is tracked in UserVaultPosition and should be decremented when a ticket
// is processed or cancelled.
pub const MAX_PENDING_TICKETS_PER_USER: u8 = 8;
