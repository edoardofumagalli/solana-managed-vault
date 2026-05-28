# Managed Vault Design

## 1. Project Overview

This project is a Solana/Anchor managed vault inspired by ERC-4626 share accounting and ERC-7540 asynchronous redemptions.

Users deposit one underlying SPL token into the vault and receive vault shares. Shares represent a proportional claim on the vault's total managed assets. Assets can be held directly in the vault token account, temporarily managed off-chain by a manager, or deployed into on-chain yield modules.

The vault is intentionally "managed": a configured manager can move part of the capital out of idle custody, but this power is bounded by a float cap, timelock, NAV reporting, module accounting, and emergency shutdown rules.

The current system contains:

- Core user deposit and asynchronous withdrawal flows.
- Manager float and off-chain NAV reporting.
- Manager withdrawal requests with a timelock.
- Emergency shutdown.
- A generic on-chain module registry.
- Generic `deploy_to_module` and `recall_from_module` instructions.
- A mock yield module used as a local harness.
- A Kamino yield module used as a real adapter/prototype.

## 2. Core Concepts

The vault is centered around a main `Vault` PDA. It stores the manager, emergency admin, underlying mint, share mint, vault token account, accounting totals, ticket counters, module totals, and configuration values.

The underlying asset is the SPL token accepted by the vault. Every deposit, withdrawal, manager return, and module movement is denominated in this token.

The share mint is an SPL mint created by the vault program. The vault PDA is the mint authority, so shares can only be minted by program logic. Users hold shares in normal token accounts.

The vault token account is the canonical token account that holds liquid underlying assets. It is owned by the vault PDA, not by the manager. This is the liquid part of the vault.

PDAs are used for program-owned state and authorities:

- `vault`: main vault state and token authority.
- `share_mint`: vault share mint.
- `withdraw_ticket`: one account per pending withdrawal request.
- `escrow_share_token_account`: holds shares while a withdrawal request is pending.
- `user_vault_position`: per-user metadata for a vault.
- `manager_withdraw_request`: pending manager withdrawal request.
- `module_entry`: per registered module strategy.
- `module_call_authority`: non-custodial signer used only to authenticate vault-originated CPIs into modules.

The manager is allowed to operate the managed parts of the vault, but does not own vault custody accounts. Users interact with deposits and withdrawals. Crankers can call permissionless accounting updates where useful.

## 3. Share And Asset Accounting

The main accounting invariant is that shares represent a proportional claim on total managed assets.

Total assets are:

```text
total_assets = vault_token_account.amount
             + float_outstanding
             + modules_nav_total
```

`vault_token_account.amount` is liquid on-chain liquidity. `float_outstanding` is manager-reported off-chain value. `modules_nav_total` is the sum of cached NAV values from registered on-chain modules.

Deposits convert assets to shares with:

```text
shares = assets * (total_shares + VIRTUAL_SHARES)
       / (total_assets + VIRTUAL_ASSETS)
```

Withdrawals convert shares to assets with:

```text
assets = shares * (total_assets + VIRTUAL_ASSETS)
       / (total_shares + VIRTUAL_SHARES)
```

Both formulas round down. Rounding down is conservative and avoids minting or paying more than the vault can justify.

The virtual assets and virtual shares keep the initial price close to 1:1 while reducing the first depositor donation attack. Without a virtual offset, an attacker could deposit a tiny amount, donate assets directly into the vault token account, and make the next depositor mint very few shares. The virtual offset makes that attack less effective because the conversion formula never starts from a fully empty denominator.

The virtual assets and shares are not real token balances. They are only used inside the conversion math.

## 4. User Deposit Flow

`deposit(amount)` lets a user deposit underlying assets and receive vault shares.

The instruction:

1. Rejects deposits during emergency shutdown.
2. Reads current total assets before the deposit.
3. Converts the deposit amount into shares using the current share price.
4. Transfers underlying tokens from the depositor to the vault token account.
5. Mints shares to the depositor share token account.
6. Emits a `DepositEvent`.

The share price includes liquid assets, manager-reported float, and synced module NAV. This means new depositors enter at the current vault value rather than only the idle vault balance.

## 5. User Withdraw Flow

User withdrawals are asynchronous. A user first requests a withdrawal by escrowing shares, then the request is processed later when it reaches the front of the queue and enough liquidity exists.

`request_withdraw(shares_amount)`:

1. Checks that the user owns enough shares.
2. Checks the per-user pending ticket cap.
3. Runs an anti-dust conversion check.
4. Transfers shares from the user to an escrow token account.
5. Creates a `WithdrawTicket` PDA.
6. Stores the ticket index, share amount, escrow account, user, and requested slot.
7. Increments `vault.total_tickets`.

The ticket uses `requested_slot` as audit metadata. The payout is not fixed at request time.

`process_withdraw`:

1. Enforces FIFO by requiring `ticket_index == vault.next_ticket_to_process`.
2. Computes the asset amount at processing time using current total assets and current share supply.
3. Requires enough liquid vault balance.
4. Transfers underlying assets to the user.
5. Burns the escrowed shares.
6. Closes the escrow token account and ticket account.
7. Decrements the user's pending ticket count.
8. Increments `vault.next_ticket_to_process`.

`cancel_withdraw`:

1. Also enforces FIFO in the current design.
2. Returns escrowed shares to the user.
3. Closes the escrow and ticket accounts.
4. Decrements the user's pending ticket count.
5. Increments `vault.next_ticket_to_process`.

FIFO keeps queue behavior simple and predictable. If a ticket cannot be processed because liquidity is insufficient, it remains pending until liquidity returns through manager deposit or module recall.

## 6. Manager Float Model

The manager float model represents assets temporarily controlled outside the vault token account.

`float_outstanding` is the current reported value of off-vault capital. It is included in total assets, so users share both gains and losses through the share price.

`manager_deposit(amount)` is permissionless. Any caller can return underlying tokens to the vault. The returned amount first reduces `float_outstanding`; any excess remains in the vault as additional assets. This makes manager returns simple and allows third parties to repay on behalf of the manager.

`report_float_value(reported_float_value)` lets the manager update the current off-chain value without moving tokens. This is the mechanism for NAV reporting:

- If the reported value increases, share price increases.
- If the reported value decreases, share price decreases.
- Users exiting after the report receive their proportional claim on the new total assets.

This model naturally handles yield and losses. The vault does not try to identify a specific user's profit or loss; it reprices all shares proportionally.

## 7. Manager Withdraw Timelock

The manager cannot immediately withdraw vault liquidity. Instead, the flow is split into request and execution.

`request_manager_withdraw(amount)`:

1. Must be signed by the current manager.
2. Is blocked during emergency shutdown.
3. Checks idle liquidity.
4. Checks the float cap using current total assets.
5. Creates a `ManagerWithdrawRequest` PDA.
6. Stores amount, receiver token account, request id, requested slot, and executable slot.

`execute_manager_withdraw`:

1. Is permissionless once the timelock has elapsed.
2. Is blocked during emergency shutdown.
3. Rechecks the current manager, liquidity, and float cap.
4. Transfers underlying from the vault token account to the configured receiver token account.
5. Increments `float_outstanding`.
6. Closes the request account.

The timelock makes manager withdrawals observable before they happen. Rechecking at execution time is important because vault state can change between request and execution.

The manager itself is updated through a two-step flow: the current manager nominates a pending manager, and the pending manager must accept.

## 8. Emergency Shutdown

Emergency shutdown is controlled by `emergency_admin`.

`activate_emergency_shutdown` sets:

- `vault.is_shutdown = true`
- `vault.shutdown_slot = current slot`

Shutdown blocks risk-increasing actions:

- User deposits.
- New manager withdrawal requests.
- Execution of pending manager withdrawal requests.
- New module deployment through `deploy_to_module`.
- Module registration.

Shutdown still allows protective or accounting actions:

- User withdrawal requests.
- User withdrawal processing.
- User withdrawal cancellation.
- Manager deposits back into the vault.
- Float NAV reporting.
- Module recall through `recall_from_module`.
- Module NAV sync.

The goal is to stop new exposure while still allowing users and operators to bring liquidity back and unwind positions.

## 9. Module System

The module system lets the vault track external on-chain strategies without embedding each protocol's logic into the core vault program.

Each registered strategy has a `ModuleEntry` PDA. It stores:

- The vault it belongs to.
- The external module program id.
- A `policy_seed` so the same module program can be registered multiple times for one vault.
- The module state account.
- The module underlying token account.
- The cached NAV for this strategy.
- The last slot when NAV was synced into the vault.
- Whether the module entry is active.

The vault stores only aggregate module value in `modules_nav_total`. Individual values live in `ModuleEntry` accounts.

Modules expose a standard header at the beginning of their state account:

```text
Anchor discriminator: 8 bytes
bump: 1 byte
vault: 32 bytes
cached_nav: 8 bytes
last_updated_slot: 8 bytes
```

The vault reads this standard header directly when syncing NAV or after module deploy/recall. This keeps the vault generic: it does not need to deserialize protocol-specific module state.

`register_module(policy_seed)` creates the `ModuleEntry`. It verifies that the module state is owned by the module program and that the registered module token account uses the vault underlying mint.

`sync_module_nav` is a permissionless crank instruction. It reads the module standard header, replaces the old cached NAV with the new one, and updates `vault.modules_nav_total` as:

```text
modules_nav_total = modules_nav_total - old_cached_nav + new_cached_nav
```

This replacement rule avoids double-counting module value.

## 10. Generic Module Interface

The vault talks to modules through a small standard interface:

```text
deposit(amount: u64)
withdraw(amount: u64)
```

The vault does not import each module crate. Instead, it builds raw CPI instructions using the Anchor discriminators for `global:deposit` and `global:withdraw`, then passes module-specific accounts as `remaining_accounts`.

`deploy_to_module(amount)`:

1. Requires the manager.
2. Is blocked during shutdown.
3. Validates the registered `ModuleEntry`.
4. Checks idle liquidity and the deployed-value cap.
5. Transfers exactly `amount` from the vault token account to the registered module underlying token account.
6. Calls the registered module's `deposit(amount)` with `module_call_authority`.
7. Reads the module standard header.
8. Atomically updates `ModuleEntry.cached_nav` and `vault.modules_nav_total`.

`recall_from_module(amount)`:

1. Requires the manager.
2. Is allowed during shutdown.
3. Validates the registered `ModuleEntry`.
4. Snapshots the vault token account balance.
5. Calls the registered module's `withdraw(amount)` with `module_call_authority`.
6. Reloads the vault token account.
7. Requires that at least `amount` underlying was returned.
8. Reads the module standard header.
9. Atomically updates `ModuleEntry.cached_nav` and `vault.modules_nav_total`.

`module_call_authority` is derived as:

```text
[MODULE_CALL_AUTHORITY_SEED, vault]
```

It is deliberately non-custodial. It authenticates that the CPI came from the vault program, but it never owns vault funds or mint authority. This is the main safety boundary between the vault and external modules.

## 11. Mock Yield Module

The mock yield module is a local harness for testing the generic module interface.

It is not intended to model production protocol logic. Its job is to behave like a simple external module that:

- Stores the standard module header.
- Has a module token account holding underlying tokens.
- Validates `module_call_authority`.
- Updates cached NAV from the module token account balance.
- Returns capital to the vault during recall.

In the mock module, `deposit(amount)` does not perform a protocol-specific CPI. The vault has already transferred underlying into the mock module token account before calling `deposit`. The mock instruction validates the call and updates cached NAV.

`withdraw(amount)` transfers underlying from the mock module token account back to the vault token account, then updates cached NAV.

This harness is useful because it tests the vault's generic dispatch, authority model, NAV update rule, shutdown behavior, and recall behavior without needing live Kamino accounts.

## 12. Kamino Yield Module

The Kamino yield module is the real adapter/prototype for deploying capital into Kamino/Klend.

The adapter owns protocol-specific knowledge. The core vault only sees the module through the standard module interface and the standard module header.

`ModuleConfig` stores mostly static configuration:

- Vault.
- Expected vault program id.
- Kamino lending market.
- Kamino reserve.
- Module type.
- Optional obligation account.

`KaminoModuleState` stores the standard module header plus Kamino-specific state:

- Expected vault program id.
- Kamino reserve.
- Lending market.
- Module type.
- Obligation.
- Initialization flag.

There are two conceptual module types:

- Token mode: the position is represented by a collateral token account owned by the module state PDA.
- Obligation mode: the position is represented inside a Kamino obligation account.

`calculate_nav` is permissionless. It reads the module position and the Kamino reserve exchange-rate data, then computes:

```text
nav = position_amount * total_liquidity / collateral_supply
```

In token mode, `position_amount` is the collateral token balance. In obligation mode, it is read from the matching reserve slot inside the obligation account.

The adapter reads selected Kamino reserve and obligation fields from raw account bytes. This keeps the integration lighter than depending on full heavy account deserialization, but it also makes offset correctness important.

Token-mode `deposit(amount)`:

1. Validates `module_call_authority`.
2. Requires token mode.
3. Requires enough underlying in the module underlying token account.
4. Builds a Klend `deposit_reserve_liquidity` instruction through `klend_interface`.
5. Uses the Kamino module state PDA as the owner signer.
6. Receives collateral tokens in the vault collateral account.
7. Recalculates cached NAV from the reserve exchange rate.

Token-mode `withdraw(amount)`:

1. Validates `module_call_authority`.
2. Requires token mode.
3. Reads the reserve exchange rate.
4. Calculates the collateral amount to redeem, rounding up.
5. Calls Klend `redeem_reserve_collateral`.
6. Sends underlying back to the vault token account.
7. Verifies that at least the requested underlying amount was returned.
8. Recalculates cached NAV.

Current status: token-mode deposit/withdraw and NAV logic exist as an adapter prototype. Full production readiness still requires real Kamino account discovery, robust integration fixtures, and broader operational cleanup.

## 13. Events And Observability

Events are emitted for the main state transitions so clients, explorers, and backend services can follow vault activity.

Core vault events include:

- Vault initialization.
- Emergency shutdown activation.
- User deposits.
- Withdrawal requested, cancelled, and processed.
- Manager withdrawal requested and executed.
- Float value reported.
- Manager deposit.
- Manager nominated and accepted.
- Module registered.
- Module NAV synced.
- Module capital deployed.
- Module capital recalled.

The mock module emits initialization, NAV calculation, deposit, and withdraw events.

The Kamino module emits deposit and withdraw events for token-mode capital movement.

These events do not replace account reads, but they make it easier to build indexers, dashboards, playground scripts, and debugging workflows.

## 14. Testing Strategy

The test suite is written in TypeScript using Anchor's provider, local validator, and SPL token helpers.

Existing tests cover:

- Vault initialization and invalid configuration.
- Deposit share minting, zero amount rejection, rounding, and donation attack behavior.
- Withdrawal request, cancellation, processing, FIFO behavior, escrow handling, and insufficient liquidity.
- End-to-end lifecycle behavior with multiple users.
- Manager deposit and permissionless float repayment.
- Manager withdrawal timelock request and execution.
- Manager update through nominate and accept.
- Float NAV reporting, including gains and losses.
- Emergency shutdown behavior.
- Module registration and NAV sync.
- Mock module initialization, NAV, direct-call rejection, generic deploy, and generic recall.
- Kamino module initialization and NAV calculation scenarios.

The mock module is the main local harness for generic module dispatch because it avoids dependence on live external protocol accounts.

## 15. Sequence Diagrams

The detailed PlantUML diagrams for the generic module flows are:

- [deploy-to-module-sequence.puml](diagrams/deploy-to-module-sequence.puml)
- [recall-from-module-sequence.puml](diagrams/recall-from-module-sequence.puml)

The deploy diagram shows how the vault transfers idle liquidity into a registered module token account, calls `global:deposit(amount)` through raw CPI, and updates module NAV atomically.

The recall diagram shows how the vault calls `global:withdraw(amount)`, verifies the returned vault token balance delta, and syncs module NAV after capital comes back.

## 16. Open Questions / Future Work

Performance fee:

- Decide whether the manager should receive a fee on profits.
- Define profit in share terms or NAV terms.
- Ensure fee minting or asset extraction cannot dilute users incorrectly.

ERC-7540 operator pattern:

- Allow approved operators or crankers to request withdrawals on behalf of users.
- Define approval storage, revocation, and signer rules.
- Decide whether operators can request only, process only, or both.

Production cleanup:

- Review account layout and migration implications before any production deployment.
- Tighten module-state versioning and standard header compatibility.
- Decide whether module entries need pause/deactivation controls.
- Improve naming consistency after the prototype phase.

Kamino integration hardening:

- Add real devnet/local fixtures for Kamino accounts.
- Automate account discovery for reserve, market, authority, collateral mint, and supplies.
- Expand token-mode integration tests beyond zero-position and synthetic NAV reads.
- Decide whether obligation-mode capital movement is in scope.

Strategy architecture:

- Support multiple modules per vault in a production-grade allocation model.
- Add a backend or cranker service to sync NAV, recall capital, and surface health checks.
- Define operational policy for mixing off-chain float and on-chain module positions.

