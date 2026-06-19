# Anchor Test Coverage Matrix

## Purpose

This matrix documents why each Anchor test file exists before any test cleanup
or deletion decision is made.

Use it together with:

- [managed-vault-design.md](managed-vault-design.md)
- [backend-api-design.md](backend-api-design.md)
- [backend-roadmap.md](backend-roadmap.md)
- [backend-manual-testing.md](backend-manual-testing.md)
- [project-cleanup-plan.md](project-cleanup-plan.md)

The immediate cleanup rule is simple: do not delete a test until this matrix
marks it as redundant and names the file or flow that preserves the same
coverage.

## Test Commands

Default local Anchor tests:

```bash
cd anchor_managed_vault
NO_DNA=1 anchor test
```

`Anchor.toml` runs:

```bash
npx ts-mocha -p ./tsconfig.json -t 1000000 "tests/local/**/*.ts"
```

Surfpool/Kamino real-account test:

```bash
cd anchor_managed_vault
npm run test:kamino:real-usdc
```

The Surfpool test requires a suitable mainnet-clone Surfpool environment and is
intentionally outside the default local test script.

## Status Labels

| Status | Meaning |
| --- | --- |
| `keep-focused` | Focused coverage for one instruction or behavior family. |
| `keep-integration` | Cross-instruction or external-protocol integration coverage. |
| `keep-helper` | Shared setup/assertion/helper code used by active tests. |
| `refactor-candidate` | Active and useful, but large or overlapping enough to review later. |
| `review-overlap` | Keep for now, but inspect overlap before expanding nearby tests. |
| `no-delete` | Do not delete without explicit replacement coverage. |

## Current Test Shape

| Area | Files | Notes |
| --- | ---: | --- |
| Local vault tests | 7 | Core user lifecycle, accounting, shutdown, and withdraw queue behavior. |
| Local manager tests | 4 | Manager float return, float reporting, timelocked withdraws, manager rotation. |
| Local module tests | 5 | Module registry, NAV sync, mock harness, generic dispatch, Kamino local module behavior. |
| Surfpool/Kamino tests | 1 | Real Klend USDC deploy/recall wiring on Surfpool. |
| Helpers | 9 | Shared PDAs, vault setup, token setup, withdraw helpers, manager helpers, module helpers, Surfpool helpers. |

## Local Vault Tests

| File | Type | Primary Coverage | Overlap / Notes | Cleanup Decision |
| --- | --- | --- | --- | --- |
| `tests/local/vault/initialize_vault.ts` | focused | Initializes vault state, share mint, vault token account, manager, emergency admin, float cap, manager withdraw delay. Rejects invalid max float bps, default emergency admin, excessive manager withdraw delay. | Unique validation coverage for initialization constraints. | `keep-focused`, `no-delete` |
| `tests/local/vault/deposit.ts` | focused | First-depositor 1:1 share minting, zero amount rejection, share rounding down, rejection when nonzero assets would mint zero shares, donation attack accounting. | Some deposit behavior appears in lifecycle tests, but this file owns edge-case accounting and adversarial donation coverage. | `keep-focused`, `no-delete` |
| `tests/local/vault/request_withdraw.ts` | focused | Escrows shares, creates ticket, validates zero shares, rejects more shares than user owns, increments ticket index, enforces per-user pending ticket cap. | Overlaps with process/cancel setup, but owns request-specific constraints. | `keep-focused`, `no-delete` |
| `tests/local/vault/cancel_withdraw.ts` | focused | Returns escrowed shares, closes ticket/escrow, advances queue, rejects cancelling a later ticket before FIFO head, allows next ticket after oldest cancellation, returns extra escrow shares. | FIFO behavior overlaps with process tests, but cancel-specific escrow return and close behavior is unique. | `keep-focused`, `no-delete` |
| `tests/local/vault/process_withdraw.ts` | focused | Transfers assets, burns escrowed shares, closes accounts, advances queue, uses processing-time share price, FIFO ordering, insufficient liquidity pending behavior, manager float return after pending ticket, blocks new manager withdrawals when processing pushes float above cap. | High-value file; overlaps with lifecycle for happy path but owns liquidity and FIFO edge cases. | `keep-focused`, `no-delete` |
| `tests/local/vault/emergency_shutdown.ts` | focused | Emergency admin activation, unauthorized activation rejection, duplicate shutdown rejection, deposit blocking after shutdown, manager withdraw request blocking after shutdown. | Shutdown behavior also appears in module recall and manager withdraw tests, but this file owns core shutdown activation and user/manager blocking. | `keep-focused`, `no-delete` |
| `tests/local/vault/lifecycle.ts` | integration | Multi-user interleaved withdrawals, proportional claims after donation, 1-unit round trip, total-assets invariant across large deposits/float/withdrawals, deposits while above float cap. | Overlap reviewed below. Keep because it verifies cross-instruction invariants that focused tests do not fully capture. Review before adding more lifecycle cases. | `keep-integration`, `refactor-candidate`, `no-delete` |

## Local Manager Tests

| File | Type | Primary Coverage | Overlap / Notes | Cleanup Decision |
| --- | --- | --- | --- | --- |
| `tests/local/manager/manager_deposit.ts` | focused | Permissionless float return, zero amount rejection, excess returned funds becoming vault assets, wrong mint rejection, non-canonical destination rejection. | Complements manager withdraw tests by covering float repayment into vault custody. | `keep-focused`, `no-delete` |
| `tests/local/manager/manager_withdraw.ts` | focused | Manager withdraw request creation, delayed execution, account close on execution, early execution rejection, zero amount rejection, float cap rejection, unauthorized manager rejection, liquidity rejection, shutdown execution blocking. | Timelock waiting appears in helpers; instruction behavior is unique here. | `keep-focused`, `no-delete` |
| `tests/local/manager/report_float_value.ts` | focused / integration | Manager reports higher/lower/zero float value, non-manager rejection, reporting during shutdown, reported NAV affects withdrawal processing, report can push vault above float cap, overflow rejection. | Some cross-flow behavior overlaps with process withdraw, but this file owns off-chain NAV reporting effects. Large but useful. | `keep-focused`, `refactor-candidate` |
| `tests/local/manager/manager_update.ts` | focused / integration | Manager nomination, default pubkey rejection, non-manager rejection, unauthorized accept rejection, accept clears pending manager, new manager authority over timelocked manager withdrawals. | Final case crosses into manager withdraw authority and is valuable integration coverage. | `keep-focused`, `no-delete` |

## Local Module Tests

| File | Type | Primary Coverage | Overlap / Notes | Cleanup Decision |
| --- | --- | --- | --- | --- |
| `tests/local/modules/register_module.ts` | focused | Registers module policy, stores module program/state/token account/policy seed, rejects non-manager, rejects duplicate module policy, blocks registration during shutdown. | Unique registry constraints. | `keep-focused`, `no-delete` |
| `tests/local/modules/sync_module_nav.ts` | focused | Syncs cached NAV from registered module state, replaces previous NAV rather than accumulating twice, rejects module state with wrong owner, rejects valid state for another vault, rejects module program mismatch. | Unique NAV sync and module entry validation coverage. | `keep-focused`, `no-delete` |
| `tests/local/modules/mock_yield_module.ts` | focused harness | Initializes mock module state and token account, calculates NAV from token balance, rejects direct deposit/withdraw because only vault CPI can sign module call authority, rejects calculate_nav with wrong token account. | Local harness safety coverage. Generic dispatch tests depend conceptually on this module behaving correctly. | `keep-focused`, `no-delete` |
| `tests/local/modules/generic_module_dispatch.ts` | integration | Vault deploys capital through generic module interface, updates NAV atomically, rejects zero amount, rejects non-manager, rejects deploy above liquidity, recalls capital and syncs reduced NAV, rejects invalid recall, allows recall during shutdown, enforces float cap on deploy. | Large and important. Overlaps with mock module behavior but owns vault-to-module CPI dispatch and accounting. | `keep-integration`, `refactor-candidate`, `no-delete` |
| `tests/local/modules/kamino_yield_module.ts` | focused / local adapter | Initializes token-mode and obligation-mode Kamino config/state, rejects invalid module type, rejects default obligation for obligation mode, calculates zero NAV for empty token/obligation positions, registers and syncs Kamino module NAV through vault. | Does not prove real Klend CPI deploy/recall. That belongs to Surfpool real USDC flow. | `keep-focused`, `no-delete` |

## Surfpool / Real Kamino Tests

| File | Type | Primary Coverage | Overlap / Notes | Cleanup Decision |
| --- | --- | --- | --- | --- |
| `tests/surfpool/kamino/real_usdc_flow.ts` | external integration | Verifies cloned Klend/Kamino USDC accounts, initializes real USDC vault and Kamino module state, registers fresh module policy, funds manager USDC with Surfpool, deposits USDC into vault, simulates and executes deploy/recall via real Klend reserve with compute budget instruction. | Only test that proves real Klend account order, oracle placeholder handling, reserve refresh CPI, collateral minting, and redeem flow. Must remain outside default local tests. | `keep-integration`, `no-delete` |

## Helper Inventory

| File | Status | Purpose | Cleanup Notes |
| --- | --- | --- | --- |
| `tests/helpers/setup.ts` | `keep-helper` | Shared Anchor provider, connection, wallet, manager, default config constants. | Small and central. Keep. |
| `tests/helpers/pda.ts` | `keep-helper` | PDA derivations for vault, share mint, token accounts, tickets, manager withdraw requests, module entries, module call authority, mock module, Kamino module. | Keep aligned with on-chain seeds and backend fixture helpers. |
| `tests/helpers/token.ts` | `keep-helper` | SPL mint/account creation, minting, transfers, mint/account fetch helpers. | Keep. |
| `tests/helpers/vault.ts` | `keep-helper` | `setupVault`, user creation, deposit helper, `setupVaultWithDeposit`. | Central to focused tests; possible future extraction if it grows. |
| `tests/helpers/withdraw.ts` | `keep-helper` | Withdraw account derivation plus request/process/cancel helper calls. | Keep because withdraw tests share account plumbing. |
| `tests/helpers/manager.ts` | `keep-helper` | Slot waiting, manager withdraw request/execute helpers, manager deposit, float reporting. | Keep; slot waiting is sensitive to local validator behavior. |
| `tests/helpers/modules.ts` | `keep-helper` | Mock module setup, module registration, registered mock module fixture. | Keep; supports module tests. |
| `tests/helpers/surfpool.ts` | `keep-helper` | Surfpool RPC helper, cloned account assertions, token account override, time travel. | Keep; only used by Surfpool-style flows. |
| `tests/helpers/assertions.ts` | `keep-helper` | Public key equality helper. | Tiny but useful. Keep. |

## Coverage Themes

| Theme | Current Coverage |
| --- | --- |
| Vault initialization | `initialize_vault.ts` |
| ERC-4626-like deposit math | `deposit.ts`, `lifecycle.ts` |
| Async withdraw request/cancel/process | `request_withdraw.ts`, `cancel_withdraw.ts`, `process_withdraw.ts`, `lifecycle.ts` |
| FIFO queue behavior | `cancel_withdraw.ts`, `process_withdraw.ts` |
| Share escrow and burn | `request_withdraw.ts`, `cancel_withdraw.ts`, `process_withdraw.ts` |
| Manager float withdraw and repayment | `manager_withdraw.ts`, `manager_deposit.ts`, `lifecycle.ts` |
| Manager float NAV reporting | `report_float_value.ts` |
| Manager rotation | `manager_update.ts` |
| Emergency shutdown | `emergency_shutdown.ts`, `manager_withdraw.ts`, `generic_module_dispatch.ts` |
| Module registry | `register_module.ts` |
| Generic module NAV sync | `sync_module_nav.ts` |
| Generic deploy/recall through mock module | `generic_module_dispatch.ts`, `mock_yield_module.ts` |
| Kamino local adapter state/NAV | `kamino_yield_module.ts` |
| Real Kamino/Klend deploy/recall | `tests/surfpool/kamino/real_usdc_flow.ts` |

## Overlap Review

No test should be deleted yet.

### Reviewed: `tests/local/vault/lifecycle.ts`

`lifecycle.ts` overlaps with the focused deposit, withdraw, and manager tests,
but the overlap is intentional. The file is valuable because it checks
cross-instruction accounting sequences rather than one instruction boundary at a
time.

| Lifecycle case | Focused overlap | Unique coverage | Decision |
| --- | --- | --- | --- |
| `handles multiple users with interleaved withdrawals and proportional claims` | Deposit share minting in `deposit.ts`; ticket creation in `request_withdraw.ts`; FIFO/process mechanics in `process_withdraw.ts`. | Two users deposit different amounts, a donation changes processing-time price, and both users withdraw sequentially from a changing asset/share base. This protects proportional claims across multiple users and multiple processed tickets. | Keep as integration coverage. This is the strongest lifecycle case. |
| `round-trips a 1 unit deposit and 1 share withdrawal without value leak` | First-depositor 1:1 minting in `deposit.ts`; standard process flow in `process_withdraw.ts`. | Minimum nonzero deposit/request/process path. Verifies user shares, share supply, vault underlying balance, and `float_outstanding` all return to zero. | Keep as a small accounting smoke test for virtual asset/share edge behavior. |
| `preserves the total_assets invariant across large deposits, float, and withdrawals` | Manager withdraw execution in `manager_withdraw.ts`; process-withdraw accounting in `process_withdraw.ts`. | Combines manager float with user withdrawal processing and checks `total_assets = vault_token_account.amount + float_outstanding + modules_nav_total` before and after a large withdrawal. | Keep. Later it could move into a clearer accounting invariants file, but it is not redundant. |
| `allows user deposits while the vault is above the float cap` | Float cap checks in `manager_withdraw.ts`; deposit conversion in `deposit.ts`; over-cap process stress in `process_withdraw.ts`. | Proves the policy distinction that float cap restricts manager/module outflows, not user deposits. Also verifies second-depositor share conversion after previous withdrawal and outstanding float. | Keep. This protects a policy decision that focused tests do not state directly. |

Lifecycle conclusion:

- Keep all four current cases.
- Do not split or delete the file in the current cleanup phase.
- Keep the file marked as `refactor-candidate` only because it is large and
  owns some local helper code.
- If the suite grows, consider renaming or splitting by invariant theme, not by
  deleting these cases.

Remaining review candidates:

1. `tests/local/manager/report_float_value.ts`
   - Keep because it owns NAV reporting effects.
   - Review structure later because it is large and combines focused validation
     with process-withdraw integration behavior.

2. `tests/local/modules/generic_module_dispatch.ts`
   - Keep because it owns vault raw-CPI module dispatch.
   - Review structure later if mock and Kamino module coverage grows.

## Cleanup Decisions

Current decisions:

- Keep all existing tests.
- Keep all four `lifecycle.ts` cases after overlap review.
- Keep Surfpool real USDC flow separate from default `anchor test`.
- Do not add manager/admin backend inspect scripts as part of test cleanup.
- Do not remove helper files until each helper's call sites are reviewed.

Next review pass:

1. Review `tests/local/manager/report_float_value.ts` for focused-vs-integration
   overlap.
2. Review `tests/local/modules/generic_module_dispatch.ts` after the manager
   review.
3. Decide whether `backend-manual-testing.md` should be split into separate
   local, mock module, and Kamino Surfpool runbooks.
