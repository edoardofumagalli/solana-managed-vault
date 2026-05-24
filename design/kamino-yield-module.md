# Kamino Yield Module Design

## Goal

Add a real yield-module adapter for Kamino Lend while keeping the vault independent from Kamino-specific implementation details.

The mock module proved the generic module pattern:

- the vault owns deposits, shares, withdrawals, and aggregate accounting;
- an external module owns strategy-specific state;
- the module writes a standardized `cached_nav` field;
- the vault syncs that NAV into `ModuleEntry` through `sync_module_nav`;
- vault total assets include `vault_token_account.amount + float_outstanding + modules_nav_total`.

The Kamino module should follow the same interface shape, but replace the mock token-holding logic with Kamino-specific NAV calculation and, later, real CPI flows into Kamino Lend.

## Design Decision

Do not replace `mock_yield_module`.

Create a new program:

```text
anchor_managed_vault/programs/kamino_yield_module
```

The mock module remains the minimal reference implementation and testing harness. The Kamino module becomes the first real protocol adapter.

This separation is useful because:

- the mock module stays easy to reason about;
- the Kamino module can evolve without breaking simple module tests;
- we can compare the two implementations to identify what is truly generic;
- the vault can support multiple module programs through the existing registry.

## Relationship With The Week-4 Prototype

The mentor's week-4 prototype includes a `kamino-module` reference implementation.

Important ideas to reuse:

- standardized module-state header;
- `ModuleConfig` account for Kamino-specific configuration;
- `KaminoModuleState` account for vault-readable NAV;
- `calculate_nav` as a permissionless instruction;
- raw byte reads for large Kamino/Klend accounts;
- support for both token-based and obligation-based Kamino positions.

Important caution:

The prototype is a reference/base pattern, not something to copy blindly. It uses older dependency versions and assumes its own vault architecture. Our implementation should adapt the pattern to the current managed-vault codebase.

## Non-Goals For The First Milestone

The first milestone does not need to implement the full capital movement into Kamino.

Specifically, milestone 1 does not include:

- a real Kamino deposit CPI;
- a real Kamino withdrawal/recall CPI;
- production-grade Kamino account discovery;
- devnet/mainnet Kamino integration scripts;
- automatic crank infrastructure;
- multiple Kamino reserves for the same vault.

The first milestone is focused on establishing the adapter shape and proving that a Kamino-compatible module can report NAV in the same way as the mock module.

## Milestone Strategy

### Milestone 1: NAV Adapter Skeleton

Implement a standalone `kamino_yield_module` program with:

```text
programs/kamino_yield_module/
  src/
    constants.rs
    errors.rs
    lib.rs
    utils.rs
    state/
      mod.rs
      module_config.rs
      kamino_module_state.rs
    instructions/
      mod.rs
      initialize.rs
      calculate_nav.rs
```

The goal is to compile and test:

1. `initialize` creates Kamino module config and state accounts.
2. `KaminoModuleState` follows the standard module header layout.
3. `calculate_nav` updates `cached_nav` and `last_updated_slot`.
4. The vault can register the Kamino module through existing `register_module`.
5. The vault can sync Kamino NAV through existing `sync_module_nav`.

### Milestone 2: Real NAV Reads

Add Kamino/Klend reserve-account parsing.

The module should compute NAV from on-chain Kamino state using raw byte offsets instead of full account deserialization.

This follows the prototype because Kamino/Klend reserve and obligation accounts are large. Fully deserializing them inside a Solana program can create stack-pressure problems.

### Milestone 3: Capital Movement

Only after NAV sync works, add real capital movement.

Potential instructions:

```text
deposit
withdraw
```

or, matching vault wording more closely:

```text
deploy
recall
```

This milestone will require real CPI calls into Kamino/Klend and more account constraints. It should be treated as a separate design step.

## Standard Module Header

The Kamino module must keep the same state layout used by the mock module and expected by the vault:

```text
offset 0..8    Anchor discriminator
offset 8..9    bump u8
offset 9..41   vault Pubkey
offset 41..49  cached_nav u64
offset 49..57  last_updated_slot u64
offset 57+     module-specific data
```

The vault's `sync_module_nav` reads:

- `vault` at offset `9`;
- `cached_nav` at offset `41`.

Because this is a raw byte interface, field order is part of the module API. Any future change to the first fields is a breaking change.

## Kamino Module State

Suggested state:

```rust
#[account]
pub struct KaminoModuleState {
    // Standard module header read by the vault.
    pub bump: u8,
    pub vault: Pubkey,
    pub cached_nav: u64,
    pub last_updated_slot: u64,

    // Kamino-specific fields.
    pub kamino_reserve: Pubkey,
    pub lending_market: Pubkey,
    pub module_type: u8,
    pub obligation: Pubkey,
    pub is_initialized: bool,
}
```

`module_type` mirrors the prototype:

| Value | Meaning | Position source |
|---|---|---|
| `0` | Token position | A collateral/kToken account balance. |
| `1` | Obligation position | A Kamino obligation deposit entry. |

For milestone 1, we can define both types but only test the simple path first.

## Module Config

Suggested state:

```rust
#[account]
pub struct ModuleConfig {
    pub bump: u8,
    pub vault: Pubkey,
    pub acting_manager: Pubkey,
    pub lending_market: Pubkey,
    pub kamino_reserve: Pubkey,
    pub module_type: u8,
    pub obligation: Pubkey,
}
```

Purpose of each field:

| Field | Purpose |
|---|---|
| `bump` | Allows the module PDA to be re-derived and signed if needed. |
| `vault` | Binds this config to one vault. |
| `acting_manager` | Future authority allowed to operate Kamino-specific actions. |
| `lending_market` | Kamino lending market this adapter targets. |
| `kamino_reserve` | Reserve used for NAV calculation and future deposits. |
| `module_type` | Selects token-based vs obligation-based accounting. |
| `obligation` | Required for obligation-based positions, default for token-based positions. |

For milestone 1, `ModuleConfig` mostly documents and stores adapter configuration. The vault does not read it directly.

## PDA Seeds

Use explicit seeds for the new program:

| PDA | Seeds | Purpose |
|---|---|---|
| `module_config` | `[b"module_config", vault]` | Stores Kamino adapter configuration for one vault. |
| `kamino_module_state` | `[b"kamino_module_state", vault]` | Stores standardized NAV state readable by the vault. |

This mirrors the prototype and keeps one Kamino module state per vault for the first implementation.

If later we need multiple Kamino strategies for the same vault, we can include `policy_seed` in the module PDAs. For this first pass, the vault already stores `policy_seed` in `ModuleEntry`, but the Kamino module state can stay one-per-vault unless we intentionally support multiple Kamino policies.

## Instruction: `initialize`

Creates `ModuleConfig` and `KaminoModuleState`.

Suggested args:

```rust
pub struct InitializeArgs {
    pub acting_manager: Pubkey,
    pub lending_market: Pubkey,
    pub kamino_reserve: Pubkey,
    pub module_type: u8,
    pub obligation: Pubkey,
}
```

Accounts:

- `payer`: signer, pays account rent;
- `vault`: unchecked account, stored in module state;
- `module_config`: PDA initialized by the Kamino module;
- `kamino_module_state`: PDA initialized by the Kamino module;
- `system_program`.

Validation:

1. `module_type` must be supported.
2. If `module_type == 1`, `obligation` must not be default.
3. If `module_type == 0`, `obligation` may be default.

Behavior:

1. Store Kamino adapter configuration in `ModuleConfig`.
2. Store standard header fields in `KaminoModuleState`.
3. Set `cached_nav = 0`.
4. Set `last_updated_slot = Clock::get()?.slot` or `0`.
5. Set `is_initialized = true`.

## Instruction: `calculate_nav`

Permissionless instruction that updates `KaminoModuleState.cached_nav`.

Accounts:

- `payer`: signer only to pay transaction fees;
- `vault`: unchecked account used to derive the module state PDA;
- `kamino_module_state`: mutable module state;
- `kamino_reserve`: Kamino reserve account;
- `vault_collateral_account`: token account used for token-position NAV;
- `collateral_mint`: collateral/kToken mint;
- `obligation`: obligation account used for state-position NAV.

Validation:

1. `kamino_module_state` must be initialized.
2. `kamino_module_state.vault` must match the passed vault.
3. `kamino_reserve` must match `kamino_module_state.kamino_reserve`.
4. For obligation type, `obligation` must match `kamino_module_state.obligation`.
5. Kamino/Klend-owned accounts should be owner-checked once the dependency is wired.

Behavior:

1. Determine the position amount:
   - token type: read `vault_collateral_account.amount`;
   - obligation type: read deposited collateral amount from obligation raw bytes.
2. Read exchange-rate components from the Kamino reserve.
3. Compute:

```text
nav = position_amount * total_liquidity / collateral_supply
```

4. Store the result in `kamino_module_state.cached_nav`.
5. Store current slot in `last_updated_slot`.

## Raw Byte Reads

The prototype reads specific fields from Kamino/Klend accounts by byte offset.

Reason: Kamino reserve and obligation accounts are large. Pulling the full struct into the program can exceed stack limits or make the instruction heavier than necessary.

For the first implementation, keep raw readers isolated in `utils.rs` or inside `calculate_nav.rs`:

```text
read_exchange_rate_components(reserve_data)
read_obligation_deposit_for_reserve(obligation_data, reserve)
```

This keeps the unsafe-feeling part of the adapter contained and easy to test.

## Vault Integration

The vault should not need a new generic accounting model.

The existing flow should work:

```text
manager/admin initializes kamino_yield_module
manager/admin calls vault register_module with kamino_yield_module program id
crank calls kamino_yield_module.calculate_nav
crank calls vault.sync_module_nav
vault.modules_nav_total updates
vault total_assets includes Kamino NAV
```

Important: `sync_module_nav` does not CPI into Kamino. It only reads the standardized header from the Kamino module state account.

## Capital Movement Design Placeholder

The mock module currently has vault-side instructions:

```text
deploy_to_mock_module
recall_from_mock_module
```

For Kamino, we should not immediately duplicate this as final architecture.

Possible options:

### Option A: Specific vault instructions

```text
deploy_to_kamino_module
recall_from_kamino_module
```

Pros:

- easier to learn;
- explicit account lists;
- mirrors current mock implementation.

Cons:

- vault starts knowing about Kamino;
- less generic as more modules are added.

### Option B: Generic vault/module dispatch later

Keep protocol-specific capital movement in adapter programs and make the vault expose more generic authorization primitives.

Pros:

- cleaner architecture;
- vault stays more protocol-agnostic.

Cons:

- harder to implement correctly;
- requires a stronger adapter interface design.

Recommendation: milestone 1 should avoid this choice. First prove NAV adapter compatibility. Then decide capital movement with the mentor after seeing exactly which Kamino accounts are required.

## Dependency Strategy

There are two different Rust crates/names to keep separate:

| Crate | Meaning | Current conclusion |
|---|---|---|
| `klend` | Anchor-generated CPI client from the Klend IDL. | Useful for CPI exploration, but heavier and currently emits SBF stack-offset errors in generated account deserializers. |
| `klend-interface` | Lightweight official interface crate from the Kamino `klend` repo. | Better candidate for future production-style CPI/instruction building, but not needed for milestone 1. |

The mentor prototype uses:

```toml
anchor-lang = "0.29.0"
anchor-spl = "0.29.0"
klend = { version = "0.1.0", features = ["cpi"] }
```

Our project uses Anchor `0.32.1`.

### Compatibility Check Result

A temporary compatibility crate was tested with:

```toml
anchor-lang = "0.32.1"
anchor-spl = "0.32.1"
klend = { version = "0.1.0", features = ["cpi"] }
```

Result:

- normal `cargo check` passes;
- `klend` resolves to the same `anchor-lang 0.32.1`, so there is no duplicate Anchor version problem;
- the expected CPI account structs compile with Anchor `0.32.1`;
- SBF build completes, but emits stack-offset errors inside generated `klend` account deserializers for large accounts such as `Reserve` and `LendingMarket`.

This means `klend = 0.1.0` is not completely unusable, but it should not be treated as the default production dependency. It was useful for understanding the prototype, not necessarily the final integration path.

The official Kamino `klend` repo also exposes `klend-interface`, which appears to be the more modern/lightweight interface crate for instruction building and zero-copy style integrations. We should evaluate `klend-interface` before implementing real Kamino capital movement.

### Milestone 1 Decision

For the NAV-only milestone, do not depend directly on either `klend` or `klend-interface`.

Instead:

- store the Klend program id as a constant;
- owner-check Kamino/Klend accounts against that constant;
- read reserve and obligation data through raw byte readers;
- do not use generated `klend::state` types;
- do not build real Klend CPI instructions yet.

This keeps the first Kamino adapter clean and focused on NAV reporting.

For later capital movement, reassess whether to:

- use `klend-interface` from the official Kamino repository;
- manually build Klend instructions;
- use `klend` CPI helpers only if the stack warnings are acceptable or avoidable;
- ask the mentor which exact dependency/instruction style he expects.

This is the main technical uncertainty for the next milestone after NAV reporting.

## Test Plan

### Milestone 1 tests

1. `initialize` creates config and module state.
2. `KaminoModuleState` has `cached_nav = 0` initially.
3. `KaminoModuleState.vault` is readable by vault `sync_module_nav` at the expected offset.
4. Vault can `register_module` using `kamino_yield_module` program id.
5. Vault can `sync_module_nav` from a Kamino module state.

### Milestone 2 tests

1. `calculate_nav` returns zero when position amount is zero.
2. `calculate_nav` updates NAV for token type using mocked reserve bytes.
3. `calculate_nav` updates NAV for obligation type using mocked obligation bytes.
4. Invalid reserve/account owner is rejected.
5. Invalid obligation for state type is rejected.

### Later integration tests

1. Real Kamino reserve account fixture or devnet test.
2. Capital deploy into Kamino.
3. Capital recall from Kamino.
4. Vault share price reflects synced Kamino NAV.

## Implementation Order

1. Add `design/kamino-yield-module.md`.
2. Scaffold `programs/kamino_yield_module`.
3. Add constants and errors.
4. Add `ModuleConfig` and `KaminoModuleState`.
5. Add `initialize`.
6. Add the program to `Anchor.toml`.
7. Run `NO_DNA=1 anchor build`.
8. Add TypeScript PDA helpers.
9. Add initialize/register/sync tests.
10. Add `calculate_nav` skeleton.
11. Add raw byte readers and NAV tests.

## Open Questions

1. Should Kamino module PDAs include `policy_seed` now, or stay one-per-vault for the first implementation?
2. Should `acting_manager` be the same as `vault.manager`, or can it be a different operational authority?
3. Should the first capital movement instruction live in the vault program or in the Kamino module only?
4. Which Kamino/Klend markets and accounts should be used for a devnet integration test?
5. Which `klend` crate version is compatible with our Anchor `0.32.1` workspace?
