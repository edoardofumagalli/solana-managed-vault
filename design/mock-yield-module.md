# Mock Yield Module Design

## Goal

Introduce the first external yield module for the managed vault.

The purpose of this feature is not to integrate Kamino yet. The purpose is to learn and implement the module pattern in a controlled way:

- the vault remains the accounting layer;
- the module is a separate Anchor program;
- the vault calls the module through CPI;
- the module owns its own state and token account;
- the vault can sync the module's NAV into vault accounting.

This is a bridge between the current manual `float_outstanding` model and a future multi-module system where capital can be deployed across Kamino, Jupiter, off-chain float, or other strategies.

## Context From The Week-4 Prototype

The week-4 prototype separates the vault from strategy modules.

The important pattern is:

```text
vault-program
  owns share accounting, deposits, withdrawals, total NAV

external module program
  owns strategy-specific state and strategy-specific CPI logic

crank / manager
  asks the module to update NAV
  asks the vault to sync the module NAV
```

The prototype uses a standardized module state layout:

```text
offset 0..8    Anchor discriminator
offset 8..9    bump
offset 9..41   vault pubkey
offset 41..49  cached_nav u64
offset 49..57  last_updated_slot u64
offset 57+     module-specific data
```

The vault can read `cached_nav` from byte offset `41` without knowing the full internal module state. This is the key abstraction.

## Design Decision

For this branch, implement the mock module through the same registry shape used by the prototype.

This means:

- add one external program: `mock_yield_module`;
- add aggregate module accounting to the vault: `modules_nav_total: u64` and `module_count: u8`;
- add a `ModuleEntry` PDA for each registered module policy;
- update vault total assets to include aggregate module NAV;
- add vault instructions that CPI into the mock module.

This keeps the implementation aligned with the future multi-module direction while still teaching the important parts:

- external program state;
- CPI from vault to module;
- signer PDA propagation;
- module-owned token account;
- NAV synchronization.

## Updated Accounting Model

Today:

```text
total_assets = vault_token_account.amount + float_outstanding
```

After this feature:

```text
total_assets = vault_token_account.amount + float_outstanding + modules_nav_total
```

Definitions:

| Field | Meaning |
|---|---|
| `vault_token_account.amount` | Liquid underlying currently idle in the vault. |
| `float_outstanding` | Manually reported off-vault value, still controlled by `report_float_value`. |
| `modules_nav_total` | Sum of the last synced NAV values across all active module entries. |

Important distinction:

```text
float_outstanding = trusted manual/off-chain value
modules_nav_total = aggregate on-chain module-reported value
```

They should not be mixed into the same field anymore.

## Vault State Changes

Add to `Vault`:

```rust
pub modules_nav_total: u64,
pub module_count: u8,
```

Initialize both fields to `0` in `initialize_vault`.

Account-size note: this changes the `Vault` account size. This is fine for the current exercise and fresh local/devnet deployments. In production with existing vaults, this would require account reallocation or migration.

## Float Cap Rule

The cap should apply to total deployed value, not only manual float.

Before:

```text
post_float_outstanding <= total_assets * max_float_bps / 10_000
```

After:

```text
post_deployed_value = float_outstanding + modules_nav_total + new_module_deposit_amount
post_deployed_value <= total_assets * max_float_bps / 10_000
```

For manual manager withdraw:

```text
post_deployed_value = post_float_outstanding + modules_nav_total
```

For module deploy:

```text
post_deployed_value = float_outstanding + modules_nav_total + amount
```

This makes the cap mean: how much value can be outside the vault's idle token account, regardless of whether it is off-chain manual float or on-chain module capital.

## Mock Module Program

Create a second Anchor program in the same workspace:

```text
anchor_managed_vault/programs/mock_yield_module
```

The mock module does not integrate with a real lending protocol. It simply holds underlying tokens in a module-owned token account and reports that token account balance as NAV.

This gives us a realistic enough module for CPI and accounting tests without depending on Kamino accounts.

## Mock Module State

Create `MockModuleState` with the standardized header first:

```rust
#[account]
pub struct MockModuleState {
    // Standard header read by the vault.
    pub bump: u8,                 // offset 8
    pub vault: Pubkey,            // offset 9
    pub cached_nav: u64,          // offset 41
    pub last_updated_slot: u64,   // offset 49

    // Mock-module-specific fields.
    pub underlying_mint: Pubkey,
    pub module_token_account: Pubkey,
    pub module_authority_bump: u8,
    pub is_initialized: bool,
}
```

The first fields must remain in this exact order so the vault can read NAV with the same offset convention as the prototype.

## Mock Module PDAs

Use these seeds:

| PDA | Seeds | Purpose |
|---|---|---|
| `mock_module_state` | `[b"mock_module_state", vault]` | Stores standardized module NAV state. |
| `mock_module_authority` | `[b"mock_module_authority", mock_module_state]` | Owns the module token account and signs capital returns back to the vault. |

The module token account can be the ATA for:

```text
mint = underlying_mint
owner = mock_module_authority PDA
```

Because the owner is a PDA, client/test derivation must use `allowOwnerOffCurve = true`.

## Mock Module Instructions

### `initialize`

Creates `MockModuleState` and the module token account.

Accounts:

- `payer`: signer, pays rent
- `vault`: unchecked account, stored in module state
- `underlying_mint`
- `mock_module_state`: PDA, initialized by module program
- `mock_module_authority`: PDA
- `module_token_account`: ATA owned by `mock_module_authority`
- `token_program`
- `associated_token_program`
- `system_program`

Behavior:

1. Store `vault`.
2. Store `underlying_mint`.
3. Store `module_token_account`.
4. Set `cached_nav = 0`.
5. Set `last_updated_slot = Clock::get()?.slot`.
6. Set `is_initialized = true`.

### `deposit`

Called by the vault program through CPI.

Accounts:

- `vault_authority`: signer, must match `mock_module_state.vault`
- `mock_module_state`: mutable
- `underlying_mint`
- `vault_token_account`: source token account, authority is `vault_authority`
- `module_token_account`: destination token account, owned by module authority
- `token_program`

Behavior:

1. Require `amount > 0`.
2. Require `vault_authority.key() == mock_module_state.vault`.
3. Transfer `amount` from vault token account to module token account.
4. Reload/read the post-transfer module token account balance.
5. Set `cached_nav = module_token_account.amount`.
6. Update `last_updated_slot`.

This proves the important CPI chain:

```text
manager signs transaction
  -> vault instruction runs
    -> vault signs as PDA with invoke_signed
      -> mock module receives vault PDA as signer
        -> mock module CPIs to SPL Token program
```

### `return_capital`

Called by the vault program through CPI.

Accounts:

- `vault_authority`: unchecked destination authority, must match `mock_module_state.vault`
- `mock_module_state`: mutable
- `mock_module_authority`: PDA that owns the module token account and signs the transfer out
- `underlying_mint`
- `module_token_account`: source token account, authority is `mock_module_authority`
- `vault_token_account`: destination token account, authority is `vault_authority`
- `token_program`

Behavior:

1. Require `amount > 0`.
2. Require `vault_authority.key() == mock_module_state.vault`.
3. Require module token balance is enough.
4. Transfer `amount` from module token account back to vault token account, signed by `mock_module_authority`.
5. Reload/read the post-transfer module token account balance.
6. Set `cached_nav = module_token_account.amount`.
7. Update `last_updated_slot`.

### `calculate_nav`

Permissionless.

Accounts:

- `payer`: signer, any caller/cranker
- `mock_module_state`: mutable
- `module_token_account`

Behavior:

1. Validate `module_token_account.key() == module_state.module_token_account`.
2. Set `cached_nav = module_token_account.amount`.
3. Set `last_updated_slot = Clock::get()?.slot`.

This lets tests simulate yield by minting underlying directly into the module token account, then calling `calculate_nav`.

## Vault Instructions

### `register_module`

Manager instruction. Registers one external module policy in the vault by creating a `ModuleEntry` PDA.

Accounts:

- `manager`: signer, must match `vault.manager` and pays rent
- `vault`: mutable
- `module_entry`: initialized PDA
- `module_program`: executable external module program
- `system_program`

PDA seeds:

```text
[b"module_entry", vault, module_program, policy_seed]
```

Behavior:

1. Require vault is not shutdown.
2. Require `vault.module_count < MAX_MODULES_PER_VAULT`.
3. Initialize `ModuleEntry` with `cached_nav = 0`, `nav_last_updated_slot = 0`, and `is_active = true`.
4. Increment `vault.module_count`.
5. Emit event.

### `deploy_to_mock_module`

Manager instruction. Moves idle vault liquidity into the mock module through CPI.

Accounts:

- `manager`: signer, must match `vault.manager`
- `vault`: mutable
- `underlying_mint`
- `vault_token_account`: mutable source
- `mock_module_program`
- `mock_module_state`: mutable
- `module_token_account`: mutable destination
- `token_program`

Behavior:

1. Require vault is not shutdown.
2. Require manager is authorized.
3. Require `amount > 0`.
4. Require vault token account has enough liquidity.
5. Compute current total assets including `modules_nav_total`.
6. Enforce deployed-value cap.
7. CPI into `mock_yield_module::deposit`, signing with the vault PDA seeds.
8. The mock module transfers tokens into its module token account and updates `MockModuleState.cached_nav`.
9. The vault does not directly update `ModuleEntry.cached_nav` or `vault.modules_nav_total` here; those are updated by `sync_module_nav`.
10. Emit event.

### `recall_from_mock_module`

Manager instruction. Pulls capital back from the module into the vault token account.

Accounts are similar to deploy, but token flow is reversed.

Behavior:

1. Require manager is authorized.
2. Require `amount > 0`.
3. Require the module token account has enough liquidity.
4. CPI into `mock_yield_module::return_capital`.
5. The vault PDA is the destination token-account authority, but it does not need to sign to receive tokens.
6. The mock module signs the outgoing transfer with `mock_module_authority` and updates `MockModuleState.cached_nav`.
7. The vault does not directly update `ModuleEntry.cached_nav` or `vault.modules_nav_total` here; those are updated by `sync_module_nav`.
8. Emit event.

Shutdown rule:

- `deploy_to_mock_module` should be blocked during shutdown.
- `recall_from_mock_module` should remain allowed during shutdown, because it brings assets back.

Accounting note:

`deploy_to_mock_module` and `recall_from_mock_module` move real tokens and update the mock module's own `cached_nav`. The vault aggregate accounting is intentionally updated by `sync_module_nav`, which copies the module header value into `ModuleEntry.cached_nav` and then updates `vault.modules_nav_total`.

### `sync_module_nav`

Permissionless instruction. Copies the module's `cached_nav` into the related `ModuleEntry` and updates `vault.modules_nav_total`.

Accounts:

- `payer`: signer, any cranker
- `vault`: mutable
- `module_entry`: mutable, tracks this module policy inside the vault
- `mock_module_state`: unchecked or typed, owned by mock module program
- `mock_module_program`

Behavior:

1. Require `mock_module_state.owner == mock_module_program.key()`.
2. Read `vault` from module state offset `9..41`.
3. Require it matches the vault PDA.
4. Read `cached_nav` from module state offset `41..49`.
5. Replace the old `ModuleEntry.cached_nav` with the new `cached_nav`.
6. Update `vault.modules_nav_total = vault.modules_nav_total - old_cached_nav + cached_nav`.
7. Set `module_entry.nav_last_updated_slot = Clock::get()?.slot`.
8. Emit event.

This mirrors the week-4 prototype and keeps the vault decoupled from module internals.

## Events

Add vault events:

```rust
#[event]
pub struct ModuleRegisteredEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_entry: Pubkey,
    pub module_program_id: Pubkey,
    pub policy_seed: u64,
    pub module_count: u8,
}

#[event]
pub struct ModuleCapitalDeployedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_entry: Pubkey,
    pub module_program_id: Pubkey,
    pub module_state: Pubkey,
    pub vault_token_account: Pubkey,
    pub module_token_account: Pubkey,
    pub amount: u64,
    pub deployed_value_after: u64,
}

#[event]
pub struct ModuleCapitalRecalledEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_entry: Pubkey,
    pub module_program_id: Pubkey,
    pub module_state: Pubkey,
    pub vault_token_account: Pubkey,
    pub module_token_account: Pubkey,
    pub amount: u64,
    pub module_cached_nav_after: u64,
}

#[event]
pub struct ModuleNavSyncedEvent {
    pub vault: Pubkey,
    pub cranker: Pubkey,
    pub module_entry: Pubkey,
    pub module_program_id: Pubkey,
    pub module_state: Pubkey,
    pub old_cached_nav: u64,
    pub new_cached_nav: u64,
    pub modules_nav_total: u64,
    pub slot: u64,
}
```

The mock module also emits:

```rust
#[event]
pub struct MockModuleInitializedEvent { ... }

#[event]
pub struct MockModuleNavCalculatedEvent { ... }

#[event]
pub struct MockModuleDepositedEvent { ... }

#[event]
pub struct MockModuleCapitalReturnedEvent { ... }
```

## Test Plan

Add focused tests for the module path.

### Module-only tests

1. Initializes `MockModuleState` with the standard layout.
2. `calculate_nav` sets `cached_nav` to the module token account balance.
3. Direct `deposit` succeeds only when the configured vault authority signs.
4. Direct `return_capital` transfers capital back to the configured vault token account using `mock_module_authority` as signer.
5. Zero-amount and insufficient-liquidity cases fail.

### Vault integration tests

1. Manager deploys assets to mock module.
   - vault token balance decreases;
   - module token balance increases;
   - mock module `cached_nav` increases;
   - `vault.modules_nav_total` increases after `sync_module_nav`;
   - total assets are restored to the full value after NAV sync.

2. Deploy respects max deployed cap.
   - `float_outstanding + modules_nav_total + amount` cannot exceed cap.

3. Mock yield increases withdrawal value.
   - deploy assets;
   - mint extra underlying directly to module token account;
   - call module `calculate_nav`;
   - call vault `sync_module_nav`;
   - process a user withdrawal and verify share price includes the higher module NAV.

4. Recall moves assets back to the vault.
   - module token balance decreases;
   - vault token balance increases;
   - mock module `cached_nav` decreases;
   - `vault.modules_nav_total` decreases after `sync_module_nav`.

5. Shutdown behavior.
   - deploy is blocked after shutdown;
   - recall is allowed after shutdown;
   - sync is allowed after shutdown.

6. Manual float and module NAV compose correctly.
   - manager withdraws manual float;
   - manager deploys module capital;
   - total assets include both `float_outstanding` and `modules_nav_total`.

## Implementation Order

1. Add this design doc.
2. Scaffold `programs/mock_yield_module` in the Anchor workspace.
3. Add mock module constants, errors, state, and events.
4. Implement mock module `initialize` and `calculate_nav`.
5. Add module PDA helpers in TypeScript tests.
6. Add `modules_nav_total` and `module_count` to `Vault` and initialize both to zero.
7. Update math helpers to include `modules_nav_total` in total assets.
8. Update existing vault instructions/tests affected by total assets.
9. Implement vault `register_module`.
10. Implement mock module `deposit` and `return_capital`.
11. Implement vault `deploy_to_mock_module`, `recall_from_mock_module`, and `sync_module_nav`.
12. Add focused integration tests.
13. Run full regression.

## Future Production Direction

This branch now follows the generic module registry shape from the week-4 prototype:

```text
Vault
  modules_nav_total
  module_count

ModuleEntry PDA per module policy
  module_program_id
  policy_seed
  cached_nav
  nav_last_updated_slot
  is_active
```

The first concrete integration is still the mock module, but the vault state is no longer hardcoded around a single module. `policy_seed` is intentionally opaque to the vault: it lets the same module program represent multiple policies/strategies for the same vault without forcing the vault to know module internals.

The concrete module state account is passed to sync/deploy/recall instructions and verified there; it is not stored permanently in `ModuleEntry`.
