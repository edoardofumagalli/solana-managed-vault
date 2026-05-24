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

Status: completed in the NAV milestone.

The module now computes NAV from Kamino-compatible state using raw byte offsets instead of full account deserialization.

Implemented behavior:

1. Token-mode NAV reads the vault collateral token account amount.
2. Obligation-mode NAV scans the obligation deposit slots for the configured reserve.
3. Reserve exchange-rate components are read from raw reserve bytes.
4. `cached_nav` and `last_updated_slot` are updated by permissionless `calculate_nav`.
5. The vault can sync the standardized module header through `sync_module_nav`.

This follows the prototype because Kamino/Klend reserve and obligation accounts are large. Fully deserializing them inside a Solana program can create stack-pressure problems.

### Milestone 3: Capital Movement

Next focus: design the first real deposit path into Kamino before implementing it.

The next design step should answer how vault capital moves from the managed vault into the Kamino adapter and then into Kamino/Klend.

Potential instruction names:

```text
deposit
withdraw
```

or, matching vault wording more closely:

```text
deploy
recall
```

For the first capital-movement milestone, start with token-mode deposit only. Obligation-mode deposit and recall are more account-heavy and should come after the simpler token-mode path is understood.

This milestone will require real CPI calls into Kamino/Klend and more account constraints. It should be treated as a separate design step before writing implementation code.

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

## Next Design Step: Deposit Into Kamino

The NAV adapter milestone is complete enough to move to capital movement design.

The mock module currently has vault-side instructions:

```text
deploy_to_mock_module
recall_from_mock_module
```

For Kamino, do not jump directly into implementation. First design the deposit path and decide where each responsibility belongs.

The first deposit design should cover:

1. Which instruction initiates the move from vault idle liquidity into Kamino.
2. Whether the instruction lives in the vault program, the Kamino module, or both through CPI.
3. Which authority signs the transfer out of the vault token account.
4. Which token account receives Kamino collateral tokens.
5. Which Kamino/Klend CPI instruction is used for token-mode deposit.
6. Which accounts are required by that CPI.
7. How `float_outstanding`, `modules_nav_total`, and `cached_nav` should change after deposit.
8. Whether deposit should immediately update NAV or require a later crank.

Recommended first slice: token-mode deposit.

Reason: token-mode is the closest shape to the mock module. The vault transfers underlying into Kamino, receives collateral/kTokens into a vault-controlled collateral token account, and then `calculate_nav` prices those collateral tokens using the reserve exchange rate.

Delay obligation-mode deposit for a later slice. Obligation-mode requires more Kamino accounts, a configured obligation, and a more complex CPI path.

### Chosen Direction: Option B, Generic Vault/Module Dispatch

Choose Option B as the target architecture.

Reason: after Kamino, the vault may integrate with other adapters such as Jupiter. If we add one vault instruction per protocol, the vault quickly becomes protocol-aware and harder to maintain. The vault should stay responsible for vault accounting and authorization, while each module owns protocol-specific CPI logic.

The intended separation is:

| Layer | Responsibility |
|---|---|
| Vault program | Shares, user deposits/withdrawals, manager authorization, float cap, module registry, exact capital movement out of the vault, aggregate NAV accounting. |
| Module program | Strategy-specific accounts, CPI into external protocols, module-local custody, `cached_nav` reporting. |
| External protocol | Kamino, Jupiter, or any future protocol used by a module. |

## Generic Deposit Design

The first generic capital movement instruction should be a vault-side instruction with a protocol-agnostic name, for example:

```text
deploy_to_module(amount)
```

This instruction should not import `kamino_yield_module`, `mock_yield_module`, or any future Jupiter module as a Rust dependency.

Instead, it should work against a registered `ModuleEntry` and a standard module interface.

### Safety Principle

Do not give an arbitrary module program signer power over the vault token account.

A tempting design is:

```text
vault deploy_to_module
  CPI into module deposit
    module receives vault PDA signer
    module transfers from vault_token_account
```

This is dangerous because a malicious or buggy module could use the vault signer to transfer more than the requested amount.

Preferred design:

```text
vault deploy_to_module
  vault transfers exactly amount from vault_token_account
  into a module-owned underlying token account
  module then uses its own authority for protocol-specific CPI
```

This keeps the vault in control of the exact amount leaving the vault. The module receives custody only over the amount deliberately deployed to it.

### Required Module Accounts

To support generic capital movement, `ModuleEntry` stores the module program id plus the concrete module accounts that the vault is allowed to interact with:

```rust
pub module_state: Pubkey,
pub module_underlying_token_account: Pubkey,
```

`module_state` makes `sync_module_nav` and capital movement bind to the same registered module instance. A sync for a different state account is rejected even if that account is owned by the same module program.

`module_underlying_token_account` is the module-owned staging account for the vault's underlying mint. The vault can safely transfer an exact amount into this account without knowing whether the module will later use Kamino, Jupiter, or another protocol.

Registration validates that:

1. `module_state` is owned by the registered module program;
2. `module_underlying_token_account` uses the same underlying mint as the vault.

Optional later field:

```rust
pub module_authority: Pubkey,
```

For now we do not store `module_authority` because different modules may derive or use authority accounts differently. The vault only needs to know the exact destination token account for deployed underlying.

For Kamino token-mode, the module may also have a separate collateral/kToken account. That account remains Kamino-module-specific and does not need to be stored in the vault's generic `ModuleEntry` unless later recall flows require it.

### Proposed Deposit Flow

Single-instruction target flow:

```text
manager calls vault.deploy_to_module(amount)

vault:
  validates manager
  validates vault is not shutdown
  validates ModuleEntry is active
  validates vault idle liquidity >= amount
  validates post-deploy cap using float_outstanding + modules_nav_total + amount
  transfers exactly amount from vault_token_account to module_underlying_token_account
  CPI-calls the registered module's standard deposit instruction
  reads the standardized module_state header after CPI
  updates ModuleEntry.cached_nav and vault.modules_nav_total
```

Module:

```text
module.deposit(amount)
  validates module state
  validates module_underlying_token_account
  uses module authority, not vault authority
  performs protocol-specific CPI
  updates module_state.cached_nav and last_updated_slot
```

For Kamino token-mode specifically:

```text
kamino_yield_module.deposit(amount)
  source liquidity: module_underlying_token_account
  source authority: kamino module authority PDA
  destination collateral: module/vault collateral token account
  external CPI: Kamino/KLend deposit-reserve-liquidity style instruction
  after CPI: update cached_nav using collateral balance and reserve exchange rate
```

### Standard Module Interface

Each yield module should expose a standard instruction name and argument shape for capital deployment, for example:

```text
deposit(amount: u64)
```

The vault can call this standard interface through raw CPI / `remaining_accounts`, without importing the concrete module crate.

Common account rule for module `deposit`:

```text
vault_authority                 signer PDA controlled by the vault program
module_specific_accounts...      supplied through remaining_accounts
```

`vault_authority` is the only account injected by the vault as a universal prefix. It proves that the module was called by the vault program, not directly by an arbitrary client. The module should validate that this signer matches the vault recorded in its config/state.

`module_state` and `module_underlying_token_account` are still mandatory for the generic vault/module contract, but their exact position is defined by each module's Anchor account context. The vault validates that both registered accounts are present in `remaining_accounts` before invoking the module.

Important safety rule: the vault must not pass `vault_token_account` or any other vault-owned source account to the module CPI. The module receives only the already-staged `module_underlying_token_account`, so even a buggy module cannot pull more than the exact amount the vault transferred first.

Protocol-specific accounts come through `remaining_accounts`. For Kamino these include module config/state, reserve, lending market, collateral mint/account, lending market authority, reserve liquidity supply, and the Klend program. For Jupiter these would be swap route accounts instead.

### Kamino `remaining_accounts` Order

`vault.deploy_to_module` builds a raw CPI into the registered module's standard `deposit(amount)` instruction.

Important: the vault instruction injects the vault PDA as the first CPI account:

```text
0. vault_authority                 signer, readonly, added by vault.deploy_to_module
```

Therefore the client/test/playground must not include `vault_authority` in `remaining_accounts`. The `remaining_accounts` list starts from the second account expected by `kamino_yield_module.deposit`.

For Kamino token-mode deposit, pass `remaining_accounts` in exactly this order:

| Index in `remaining_accounts` | Kamino deposit account | Writable | Signer | Purpose |
|---:|---|---|---|---|
| `0` | `module_config` | no | no | Stores Kamino adapter configuration and binds the module to the vault. |
| `1` | `kamino_module_state` | yes | no | Module PDA state; signs the Klend CPI internally and stores updated `cached_nav`. |
| `2` | `kamino_reserve` | yes | no | Klend reserve being deposited into; must match module state. |
| `3` | `lending_market` | no | no | Klend lending market configured for this module. |
| `4` | `lending_market_authority` | no | no | Klend PDA authority for the lending market. |
| `5` | `reserve_liquidity_mint` | no | no | Underlying/liquidity mint accepted by the reserve. |
| `6` | `reserve_liquidity_supply` | yes | no | Reserve liquidity supply token account receiving deposited liquidity. |
| `7` | `reserve_collateral_mint` | yes | no | Collateral/kToken mint used by Klend. |
| `8` | `module_underlying_token_account` | yes | no | Registered module staging account already funded by the vault before CPI. |
| `9` | `vault_collateral_account` | yes | no | Module-owned collateral/kToken account that receives minted collateral. |
| `10` | `token_program` | no | no | SPL Token program used by collateral accounts. |
| `11` | `liquidity_token_program` | no | no | SPL Token program used by liquidity accounts. |
| `12` | `klend_program` | no | no | Kamino/Klend program. |
| `13` | `instruction_sysvar` | no | no | Instructions sysvar required by the Klend deposit instruction. |

Full CPI account order seen by `kamino_yield_module.deposit`:

```text
vault_authority,
module_config,
kamino_module_state,
kamino_reserve,
lending_market,
lending_market_authority,
reserve_liquidity_mint,
reserve_liquidity_supply,
reserve_collateral_mint,
module_underlying_token_account,
vault_collateral_account,
token_program,
liquidity_token_program,
klend_program,
instruction_sysvar
```

The two accounts that must match `ModuleEntry` are:

```text
kamino_module_state == module_entry.module_state
module_underlying_token_account == module_entry.module_underlying_token_account
```

This order is part of the generic module interface contract. If the account order in `kamino_yield_module.deposit` changes, any client/test/playground building `remaining_accounts` must be updated at the same time.

### NAV Update Rule

After a successful module deposit, the module should update its own `cached_nav`.

Then the vault instruction should read the standard header from `module_state` and update:

```text
module_entry.cached_nav
vault.modules_nav_total
```

This avoids a temporary state where assets have left the vault token account but are not yet represented in `modules_nav_total`.

Target implementation:

```text
vault.deploy_to_module(amount, remaining_accounts...)
```

`deploy_to_module` should be the single manager-facing entrypoint for deploying capital into any registered module.

The vault instruction should:

1. validate manager authorization, shutdown state, module registration, idle liquidity, and float cap;
2. transfer exactly `amount` from `vault_token_account` into the registered `module_underlying_token_account`;
3. CPI-call the registered module program's standard `deposit(amount)` instruction;
4. pass the vault PDA as `vault_authority` signer for module authentication only;
5. pass protocol-specific module accounts through `remaining_accounts`;
6. reload/read the standardized module state header after CPI;
7. update `module_entry.cached_nav` and `vault.modules_nav_total` in the same instruction.

The module instruction should:

1. reject direct calls that do not include the vault PDA as signer;
2. validate its own module state/config and staging token account;
3. use its own module authority to spend from `module_underlying_token_account`;
4. perform protocol-specific CPI, such as Kamino/Klend deposit;
5. update `module_state.cached_nav` and `last_updated_slot` before returning.

This removes the intermediate client sequence:

```text
vault.deploy_to_module(amount)
kamino_yield_module.deposit(amount)
vault.sync_module_nav()
```

`sync_module_nav` should remain as a permissionless fallback/crank instruction, but the happy path should not require it after a successful deploy.

### Accounting Rule

Deploying capital to an on-chain module should not increase `float_outstanding`.

Reason: `float_outstanding` represents manager-controlled/off-vault reported value. Kamino/Jupiter module value should be represented by `modules_nav_total` through module NAV sync.

The relevant deployed-value cap should continue to reason about:

```text
float_outstanding + modules_nav_total + newly_deployed_amount
```

Pre-deploy cap checks can use `newly_deployed_amount`. After the module updates NAV, the vault should store the actual module NAV reported by the module.

### Implementation Refactor Plan

Implement the generic pattern in this order:

1. Refactor `kamino_yield_module.deposit` so it can be called by the vault PDA signer instead of directly relying on a client/manager signer.
2. Refactor `deploy_to_module` to build a raw CPI to the registered module program and pass module-specific accounts through `remaining_accounts`.
3. Make `deploy_to_module` read the standardized module header after CPI and update `module_entry.cached_nav` plus `vault.modules_nav_total` atomically.
4. Add focused Kamino pre-CPI tests where possible, then add a devnet/local-fixture playground for the real Klend CPI path.
5. Optionally adapt the mock module later as a generic harness if we want a fully local test for the same interface without Kamino accounts.

This keeps the current branch focused on the Kamino adapter while still moving toward the generic module pattern. The mock module is useful as a future test harness, but it is not required to complete the Kamino deposit refactor.

### Design Tradeoff

This design is more work than `deploy_to_kamino_module`, but it gives us a better path for Jupiter and future adapters.

The price is that we must define and respect a small module interface contract:

1. standard state header;
2. standard capital deployment instruction shape;
3. module-owned underlying token account;
4. module-updated `cached_nav` after protocol-specific work.

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

Status: partially completed.

Implemented:

1. `calculate_nav` returns zero when token position amount is zero.
2. `calculate_nav` returns zero when obligation position amount is zero.
3. Vault can register and sync the Kamino module NAV.

Still useful later:

1. `calculate_nav` updates NAV for token type using mocked reserve bytes.
2. `calculate_nav` updates NAV for obligation type using mocked obligation bytes.
3. Invalid reserve/account owner is rejected.
4. Invalid obligation for state type is rejected.

These non-zero raw-byte tests likely need either Rust-side parser tests, validator fixtures with custom account data, or a devnet/local fixture strategy.

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
12. Design token-mode deposit into Kamino.
13. Implement token-mode deposit only after the deposit account model is clear.

## Open Questions

1. Should Kamino module PDAs include `policy_seed` now, or stay one-per-vault for the first implementation?
2. Which real Kamino/Klend market, reserve, and token accounts should be used for a devnet end-to-end playground?
3. How should the future recall/withdraw path from Kamino be shaped, and what account order will it require?
