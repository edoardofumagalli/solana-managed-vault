# Project Cleanup Plan

## Purpose

This document is the operating inventory for cleaning up the managed vault
project without losing useful work.

It covers the whole repository, not only the backend:

- root and `design/` documentation;
- Rust backend;
- Anchor programs;
- Anchor tests;
- manual backend scripts;
- Surfpool/TXTX runbooks;
- package, Anchor, Cargo, and git ignore configuration.

The goal is to decide what to keep, what to archive, what to refactor, and what
may eventually be removed. This file should be updated as cleanup decisions are
made.

## Cleanup Rules

Use these rules for every cleanup pass:

1. Do not delete files until they have an explicit status in this document.
2. Prefer archiving or documenting historical context before removal.
3. Keep one cleanup theme per commit.
4. Do not mix behavior changes with documentation cleanup.
5. Do not refactor tests and production code in the same commit unless the test
   change is required by the production refactor.
6. When touching Anchor program code, run the Anchor verification path.
7. When touching backend Rust code, run the backend Rust verification path.
8. When touching manual scripts, run at least the relevant script help or a dry
   inspect flow.
9. Keep generated local artifacts ignored and out of commits.

## Status Taxonomy

Use these labels in the inventory:

| Status | Meaning |
| --- | --- |
| `keep-source` | Source of truth for current behavior or design. |
| `keep-operational` | Operational file used to run, test, deploy, or inspect the project. |
| `keep-historical` | Useful history or exercise context, but not current implementation guidance. |
| `refactor-candidate` | Useful and active, but too large, duplicated, or hard to maintain. |
| `archive-candidate` | Probably should move under an archive/docs history area or be replaced by current docs. |
| `delete-candidate` | Probably removable after one explicit verification pass. |
| `generated-local` | Local generated output. Keep ignored; do not commit. |
| `needs-decision` | Requires a human decision before action. |

## Current Sources Of Truth

These files should remain the primary references while cleanup is in progress:

| Path | Status | Notes |
| --- | --- | --- |
| `README.md` | `keep-source` | Root documentation map. Use it to find current source-of-truth docs and archived historical material. |
| `design/managed-vault-design.md` | `keep-source` | Current on-chain model: share accounting, async withdraws, manager float, shutdown, modules, Kamino. |
| `design/backend-api-design.md` | `keep-source` | Current backend API contract, response shape, endpoint inputs, module `remainingAccounts`, implementation phases. |
| `design/backend-roadmap.md` | `keep-source` | Current practical roadmap after backend and mentor review. Good reference for Kamino and future compute/read phases. |
| `design/backend-manual-testing.md` | `keep-operational` | Stable manual testing entrypoint. Detailed runbooks now live under `design/testing/`. |
| `design/testing/*.md` | `keep-operational` | Split manual testing runbooks for common setup, user flow, mock modules, Kamino Surfpool, and transaction build references. |
| `design/anchor-test-coverage-matrix.md` | `keep-source` | Current inventory of Anchor test coverage. Use before deleting or refactoring tests. |
| `design/diagrams/*.puml` | `keep-source` | Sequence diagrams for module deploy/recall. Keep linked from design docs. |
| `design/archive/README.md` | `keep-historical` | Archive index for historical documents. |

## Documentation Inventory

### Root Documentation

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `README.md` | `keep-source` | Root navigation map added during Phase A. It points to current source-of-truth docs and the archive. |
| `progress-report.md` | `generated-local` / ignored | Local progress report ignored by git. Keep out of source-of-truth docs unless we intentionally create a tracked status document. |

### Archived Documentation

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `design/archive/README.md` | `keep-historical` | Archive index. Keep short and update when more historical docs move here. |
| `design/archive/managed-vault-task.md` | `keep-historical` | Original exercise brief. Archived during Phase A. Do not use as current implementation source. |
| `design/archive/erc-comparison.md` | `keep-historical` | Early ERC-4626/ERC-7540 mapping from the initial learning phase. Archived during Phase A. |
| `design/archive/implementation-strategy.md` | `keep-historical` | Early implementation plan. Broken design-decision link was replaced with current design references before archiving. |

### Design Documentation

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `design/managed-vault-design.md` | `keep-source` | Keep as canonical on-chain design. Consider adding links to historical docs after archive structure exists. |
| `design/backend-api-design.md` | `keep-source`, `refactor-candidate` | Keep as canonical backend contract. Later separate completed phases from future phases if it keeps growing. |
| `design/backend-roadmap.md` | `keep-source` | Keep as step-by-step roadmap. Later update after cleanup and compute budget work. |
| `design/backend-manual-testing.md` | `keep-operational` | Keep as a short compatibility entrypoint for existing links. |
| `design/testing/README.md` | `keep-operational` | Manual testing documentation map and common prerequisites. |
| `design/testing/backend-user-flow-testing.md` | `keep-operational` | Local deposit and async withdraw manual runbook. |
| `design/testing/backend-module-testing.md` | `keep-operational` | Local mock module manual runbook. |
| `design/testing/backend-kamino-surfpool-testing.md` | `keep-operational` | Kamino USDC Surfpool manual runbook. |
| `design/testing/backend-transaction-build-reference.md` | `keep-operational` | Saved transaction build and blockhash reference. |
| `design/anchor-test-coverage-matrix.md` | `keep-source` | Keep as the test cleanup source of truth. Update whenever test files are added, split, removed, or reclassified. |
| `design/project-cleanup-plan.md` | `keep-source` | This file. Update whenever cleanup decisions change. |

## Backend Inventory

The backend is active and should not be deleted. Main cleanup need: reduce
boilerplate and improve module boundaries after current transaction builders are
stable.

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `backend/Cargo.toml`, `backend/Cargo.lock` | `keep-operational` | Backend crate metadata and lockfile. Keep tracked. |
| `backend/src/main.rs` | `keep-source` | Axum app entrypoint. Small and healthy. |
| `backend/src/config.rs` | `keep-source` | App config. Keep; later add env documentation if config grows. |
| `backend/src/api.rs` | `keep-source`, `refactor-candidate` | Contains request DTOs, response DTOs, error model, summary types. Active but growing. Later split by domain: user, manager, admin, modules, shared. |
| `backend/src/routes/transactions.rs` | `keep-source`, `refactor-candidate` | Active but very large. Split into user, manager, admin, modules route modules after behavior is stable. |
| `backend/src/routes/health.rs` | `keep-source` | Small health endpoint. Keep. |
| `backend/src/routes/config.rs` | `keep-source` | Small config endpoint. Keep. |
| `backend/src/routes/rpc.rs` | `keep-source` | Small RPC health endpoint. Keep. |
| `backend/src/builders/deposit.rs` | `keep-source` | Endpoint-specific instruction/account builder. Keep. |
| `backend/src/builders/withdraw.rs` | `keep-source` | User withdraw builders. Keep. |
| `backend/src/builders/manager.rs` | `keep-source` | Manager float and manager withdraw builders. Keep. |
| `backend/src/builders/admin.rs` | `keep-source` | Emergency and manager update builders. Keep. |
| `backend/src/builders/modules.rs` | `keep-source`, `refactor-candidate` | Active module builder. Later split generic module helpers from endpoint builders if Kamino grows. |
| `backend/src/builders/common.rs` | `keep-source` | Shared parser and role helpers. Keep. |
| `backend/src/services/rpc.rs` | `keep-source` | RPC account fetch/deserialization. Keep; later add richer account resolvers if needed. |
| `backend/src/services/transaction_builder.rs` | `keep-source` | Unsigned `VersionedTransaction` helper. Keep; likely target for compute budget additions. |
| `backend/src/services/transaction_simulator.rs` | `keep-source` | Optional simulation. Keep; likely target for compute budget tuning. |

Backend cleanup order:

1. Extract repeated route boilerplate for blockhash and vault fetch.
2. Split `routes/transactions.rs` by endpoint family.
3. Split `api.rs` only after route split is done.
4. Improve structured error codes after split, not before.
5. Add compute budget tuning in `transaction_builder` / `transaction_simulator`
   after the cleanup baseline is committed.

Verification for backend cleanup:

```bash
cd backend
NO_DNA=1 cargo check
```

## Anchor Program Inventory

### Core Vault Program

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `anchor_managed_vault/programs/anchor_managed_vault` | `keep-source` | Core managed vault program. Do not restructure during documentation/script cleanup. |
| `src/lib.rs` | `keep-source` | Program instruction entrypoint. Keep. |
| `src/instructions/admin/*` | `keep-source` | Initialize, shutdown, register module, manager update. Keep. |
| `src/instructions/user/*` | `keep-source` | Deposit and async withdraw flow. Keep. |
| `src/instructions/manager/*` | `keep-source` | Manager float, manager withdraw, module deploy/recall. Keep. |
| `src/instructions/crank/*` | `keep-source` | Permissionless NAV sync. Keep. |
| `src/state/*` | `keep-source` | Vault, tickets, user position, manager request, module entry. Keep. |
| `src/math.rs` | `keep-source` | Share/accounting math. Keep. |
| `src/events.rs`, `src/errors.rs`, `src/constants.rs` | `keep-source` | Program-level interfaces and invariants. Keep. |
| `src/test-ledger/` | `generated-local`, `delete-candidate` | Local validator output inside `src/`. It is ignored, but misplaced. Remove locally in a dedicated cleanup command after explicit approval. Do not commit. |

### Mock Yield Module

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `anchor_managed_vault/programs/mock_yield_module` | `keep-source` | Local harness for generic module interface. Keep. |
| `src/instructions/*` | `keep-source` | Initialize, calculate NAV, deposit, withdraw. Keep because generic module tests depend on it. |
| `src/state/*`, `src/events.rs`, `src/errors.rs`, `src/constants.rs` | `keep-source` | Harness state and validation. Keep. |

### Kamino Yield Module

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `anchor_managed_vault/programs/kamino_yield_module` | `keep-source` | Real/prototype adapter for Kamino/Klend. Keep. |
| `src/instructions/initialize.rs` | `keep-source` | Module config/state initialization. Keep. |
| `src/instructions/calculate_nav.rs` | `keep-source` | NAV calculation. Keep; future backend may need helper transaction flow. |
| `src/instructions/deposit.rs` | `keep-source` | Kamino deploy-side adapter. Keep. |
| `src/instructions/withdraw.rs` | `keep-source` | Kamino recall-side adapter. Keep. |
| `src/utils.rs` | `keep-source` | Reserve/oracle/exchange-rate utilities. Keep. |
| `src/state/*`, `src/events.rs`, `src/errors.rs`, `src/constants.rs` | `keep-source` | Adapter state and validation. Keep. |

Verification for Anchor program cleanup:

```bash
cd anchor_managed_vault
NO_DNA=1 anchor build
NO_DNA=1 anchor test
```

Use the Surfpool/Kamino flow only when the cleanup touches Kamino account
routing, runbooks, or Surfpool helpers.

## Test Inventory

The current tests appear useful. Do not delete tests until a test matrix marks a
file as redundant and the replacement coverage is explicit.

The detailed coverage matrix is now tracked in
`design/anchor-test-coverage-matrix.md`.

| Path | Status | Coverage |
| --- | --- | --- |
| `anchor_managed_vault/tests/local/vault/initialize_vault.ts` | `keep-source` | Vault initialization constraints. |
| `anchor_managed_vault/tests/local/vault/deposit.ts` | `keep-source` | Deposit math, rounding, donation attack. |
| `anchor_managed_vault/tests/local/vault/request_withdraw.ts` | `keep-source` | Ticket creation, escrow, caps. |
| `anchor_managed_vault/tests/local/vault/cancel_withdraw.ts` | `keep-source` | FIFO cancellation and escrow return. |
| `anchor_managed_vault/tests/local/vault/process_withdraw.ts` | `keep-source` | Processing, liquidity, FIFO, float stress. |
| `anchor_managed_vault/tests/local/vault/lifecycle.ts` | `keep-source`, `refactor-candidate` | Cross-flow lifecycle and invariants. Keep, but review overlap with unit-style files. |
| `anchor_managed_vault/tests/local/vault/emergency_shutdown.ts` | `keep-source` | Shutdown behavior. |
| `anchor_managed_vault/tests/local/manager/*` | `keep-source` | Manager deposit, timelock withdraw, float reporting, manager update. |
| `anchor_managed_vault/tests/local/modules/register_module.ts` | `keep-source` | Module registration constraints. |
| `anchor_managed_vault/tests/local/modules/sync_module_nav.ts` | `keep-source` | NAV replacement rule and invalid module states. |
| `anchor_managed_vault/tests/local/modules/generic_module_dispatch.ts` | `keep-source` | Generic deploy/recall through mock harness. |
| `anchor_managed_vault/tests/local/modules/mock_yield_module.ts` | `keep-source` | Mock module harness behavior. |
| `anchor_managed_vault/tests/local/modules/kamino_yield_module.ts` | `keep-source` | Kamino module local initialization/NAV behavior. |
| `anchor_managed_vault/tests/surfpool/kamino/real_usdc_flow.ts` | `keep-source`, `keep-operational` | Real cloned Kamino/Klend flow. Keep separate from default local tests. |
| `anchor_managed_vault/tests/helpers/*` | `keep-source`, `refactor-candidate` | Shared setup, PDA, token, manager, withdraw, module, Surfpool helpers. Review duplicate setup logic later. |

Test cleanup order:

1. Add a test matrix document or section mapping files to behavior.
2. Mark overlap between `lifecycle.ts` and focused vault tests.
3. Only remove a test after another test is named as replacement coverage.
4. Keep Surfpool real-account tests outside default `anchor test`.

Verification for test cleanup:

```bash
cd anchor_managed_vault
NO_DNA=1 anchor test
```

For Surfpool/Kamino:

```bash
cd anchor_managed_vault
npm run test:kamino:real-usdc
```

Run the Surfpool test only with a suitable Surfpool mainnet-clone environment.

## Script Inventory

Manual backend scripts are useful, but they now contain repeated code. The
first cleanup should extract shared helpers rather than remove scripts.

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `anchor_managed_vault/scripts/setup_backend_fixture.ts` | `keep-operational`, `refactor-candidate` | Main backend fixture setup. Very large. Later split common fixture helpers, mock module helpers, Kamino helpers, and CLI entrypoint. |
| `anchor_managed_vault/scripts/sign_backend_transaction.js` | `keep-operational` | Explicit review/sign/send script. Keep because it enforces manual signing boundary. |
| `anchor_managed_vault/scripts/inspect_deposit_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Later reuse shared inspect helper. |
| `anchor_managed_vault/scripts/inspect_request_withdraw_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Later reuse shared inspect helper. |
| `anchor_managed_vault/scripts/inspect_cancel_withdraw_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Later reuse shared inspect helper. |
| `anchor_managed_vault/scripts/inspect_process_withdraw_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Later reuse shared inspect helper. |
| `anchor_managed_vault/scripts/inspect_register_module_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Supports fixture module modes. |
| `anchor_managed_vault/scripts/inspect_sync_module_nav_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Supports fixture module modes. |
| `anchor_managed_vault/scripts/inspect_deploy_to_module_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Handles ordered `remainingAccounts`. |
| `anchor_managed_vault/scripts/inspect_recall_from_module_transaction.js` | `keep-operational`, `refactor-candidate` | Active inspect script. Handles ordered `remainingAccounts`. |

Script cleanup order:

1. Create shared JS helper for backend inspect scripts:
   - backend URL resolution;
   - argument parsing primitives;
   - HTTP request;
   - output file writing;
   - summary printing;
   - `VersionedTransaction` decode printing.
2. Update one inspect script first as a pattern.
3. Convert the remaining inspect scripts incrementally.
4. Split `setup_backend_fixture.ts` only after inspect helper extraction.
5. Remove the legacy `playground.ts` script after fixture and manual testing
   flows replace it.

Completed Phase C decisions:

- `anchor_managed_vault/scripts/playground.ts` was removed because the backend
  fixture setup script, manual inspect/sign scripts, and Anchor tests now cover
  its old direct local flow. The `playground` entries were also removed from
  `anchor_managed_vault/package.json` and `anchor_managed_vault/Anchor.toml`.

Verification for script cleanup:

```bash
cd anchor_managed_vault
npm run lint
npm run backend:fixture:setup -- --help
npm run backend:deposit:inspect -- --help
```

For changed module scripts, run the relevant `backend:modules:*:inspect --help`
or a fixture-backed inspect flow.

## Runbook And Infra Inventory

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `anchor_managed_vault/txtx.yml` | `keep-operational` | Surfpool/TXTX config. Keep. |
| `anchor_managed_vault/runbooks/deployment/main.tx` | `keep-operational` | Deploys the three Anchor programs. Keep. |
| `anchor_managed_vault/runbooks/deployment/signers.localnet.tx` | `keep-operational` | Local signer config. Keep, but ensure no private keys are committed. |
| `anchor_managed_vault/runbooks/deployment/signers.devnet.tx` | `keep-operational` | Web wallet signer template. Keep. |
| `anchor_managed_vault/runbooks/deployment/signers.mainnet.tx` | `keep-operational` | Web wallet/mainnet template. Keep; mainnet usage requires explicit confirmation. |
| `anchor_managed_vault/runbooks/README.md` | `keep-operational`, `refactor-candidate` | Generated/generic Surfpool text. Rewrite into project-specific runbook instructions. |

Runbook cleanup order:

1. Rewrite `runbooks/README.md` around this project only.
2. Document the preferred Surfpool command:
   `NO_DNA=1 surfpool start --network mainnet --no-tui --yes --watch --airdrop-keypair-path "$HOME/.config/solana/id.json"`.
3. Explain when `--watch` is required and when it can be omitted.
4. Keep signer files free of raw private keys.

## Config And Ignore Inventory

| Path | Status | Cleanup Decision |
| --- | --- | --- |
| `.gitignore` | `keep-operational` | Root ignore file. Already ignores `.tmp`, backend target, Anchor target, Surfpool local outputs, and nested test ledgers. |
| `anchor_managed_vault/.gitignore` | `keep-operational` | Anchor workspace ignore file. Keep aligned with root ignore. |
| `anchor_managed_vault/.prettierignore` | `keep-operational` | Keep. Do not introduce `.prettierrc` unless explicitly requested. |
| `anchor_managed_vault/package.json` | `keep-operational`, `refactor-candidate` | Scripts are useful. Legacy `playground` script was removed during Phase C. |
| `anchor_managed_vault/Anchor.toml` | `keep-operational` | Program IDs and default test script. Legacy `playground` script was removed during Phase C. |
| `anchor_managed_vault/Cargo.toml`, `anchor_managed_vault/Cargo.lock` | `keep-operational` | Anchor Rust workspace metadata. Keep. |
| `anchor_managed_vault/package-lock.json` | `keep-operational` | Node lockfile. Keep. |
| `anchor_managed_vault/rust-toolchain.toml` | `keep-operational` | Toolchain pin. Keep. |
| `anchor_managed_vault/tsconfig.json` | `keep-operational` | TS config for tests/scripts. Keep. |
| `anchor_managed_vault/migrations/deploy.ts` | `keep-operational`, `needs-decision` | Default Anchor migration. Keep unless confirmed unused. |

## Generated Local Artifacts

These should not be committed. They may be removed locally in a dedicated
cleanup step after explicit approval:

| Path | Status | Notes |
| --- | --- | --- |
| `anchor_managed_vault/.tmp/` | `generated-local` | Manual backend transaction outputs. Ignored. |
| `.tmp/` | `generated-local` | Root local script outputs. Ignored. |
| `anchor_managed_vault/target/` | `generated-local` | Anchor/Rust build output. Ignored. |
| `backend/target/` | `generated-local` | Backend build output. Ignored. |
| `anchor_managed_vault/.anchor/` | `generated-local` | Anchor local output. Ignored. |
| `anchor_managed_vault/.surfpool/` | `generated-local` | Surfpool local output. Ignored. |
| `test-ledger/`, `anchor_managed_vault/**/test-ledger/` | `generated-local`, `delete-candidate` | Local validator ledgers. One was observed under `programs/anchor_managed_vault/src/test-ledger/`; remove locally after approval. |
| `*.log` | `generated-local` | Runtime logs. Ignored. |

## Recommended Cleanup Sequence

### Phase A: Documentation Baseline

Goal: make navigation obvious.

Status: completed in the Phase A documentation commit.

Completed decisions:

1. Added a root `README.md` that points to current source-of-truth docs.
2. Moved historical root docs under `design/archive/`.
3. Added `design/archive/README.md` as the archive index.
4. Fixed the broken historical link in `implementation-strategy.md` before archiving it.

Archived files:

- `design/archive/managed-vault-task.md`
- `design/archive/erc-comparison.md`
- `design/archive/implementation-strategy.md`

Remaining optional follow-up:

1. Keep the split testing docs aligned as new endpoint families get manual
   scripts.

Suggested commits:

- `docs: establish cleanup documentation baseline`

### Phase B: Generated Artifact Cleanup

Goal: remove local clutter without changing tracked code.

1. Confirm generated local paths.
2. Remove misplaced local `test-ledger` directories after explicit approval.
3. Re-run `git status --short` and `git check-ignore -v` on generated paths.

Suggested commit:

- Usually no commit if only ignored local files are removed.

### Phase C: Script Maintainability

Goal: reduce duplication in manual backend scripts.

1. Add shared inspect helper.
2. Convert one inspect script as reference.
3. Convert the remaining inspect scripts in small commits.
4. Split `setup_backend_fixture.ts` after inspect helpers are stable.
5. Remove `playground.ts` after fixture/manual testing replacement is complete.

Suggested commits:

- `chore: add shared backend inspect script helpers`
- `chore: migrate backend inspect scripts to shared helpers`
- `chore: split backend fixture setup helpers`
- `chore: remove legacy playground script`

### Phase D: Test Documentation

Goal: know why every test exists before deleting any.

Status: first coverage matrix added in `design/anchor-test-coverage-matrix.md`.
The `tests/local/vault/lifecycle.ts` overlap review is complete and all four
cases are explicitly kept.
The `tests/local/manager/report_float_value.ts` overlap review is complete and
all nine cases are explicitly kept.
The `tests/local/modules/generic_module_dispatch.ts` overlap review is complete
and all ten cases are explicitly kept.

1. Add a test matrix. Completed.
2. Mark overlap and unique coverage.
3. Only then decide if any test is redundant.

Suggested commit:

- `docs: add Anchor test coverage matrix`

### Phase E: Backend Refactor

Goal: reduce Rust route/API size without changing endpoint behavior.

1. Extract repeated route helper logic.
2. Split transaction routes by domain.
3. Split API DTOs by domain.
4. Improve error codes.
5. Then resume compute budget tuning.

Suggested commits:

- `refactor: share backend transaction route context`
- `refactor: split backend transaction routes by domain`
- `refactor: split backend API DTO modules`

## Open Decisions

| Decision | Options | Recommended Default |
| --- | --- | --- |
| Where should historical docs live? | Root, `design/archive/`, `docs/archive/`. | Decided in Phase A: `design/archive/`. |
| Should manual testing docs be split? | Keep single file, split by flow. | Decided: split into `design/testing/` and keep `design/backend-manual-testing.md` as the entrypoint. |
| Should manager/admin inspect scripts be added? | Add now, defer. | Defer until script helper cleanup is done. |
| Should backend DTOs be split now? | Split now, wait. | Wait until route helper cleanup starts. |
| Should local generated ledgers be removed now? | Remove ignored local files, keep. | Remove after explicit approval because they are generated and misplaced. |

## Verification Matrix

Use the smallest verification that matches the cleanup area:

| Cleanup Area | Verification |
| --- | --- |
| Markdown docs only | `git diff --check` |
| Backend Rust | `cd backend && NO_DNA=1 cargo check` |
| Anchor program code | `cd anchor_managed_vault && NO_DNA=1 anchor build && NO_DNA=1 anchor test` |
| Anchor TypeScript tests | `cd anchor_managed_vault && npm run lint && NO_DNA=1 anchor test` |
| Manual backend scripts | `cd anchor_managed_vault && npm run lint` plus relevant `--help` or inspect flow |
| Kamino/Surfpool routing | Surfpool mainnet clone plus Kamino manual flow from `design/testing/backend-kamino-surfpool-testing.md` |
| Git ignore / generated files | `git status --short` and `git check-ignore -v <path>` |

## Immediate Next Step

Phase D overlap review is complete for the current `refactor-candidate`
integration tests, and the manual backend testing runbook has been split into
`design/testing/`.

1. Proceed to Phase E backend refactor planning: route helper extraction, route
   split, then API DTO split.
2. Keep the Anchor test files unchanged unless a future matrix update names
   explicit replacement coverage.
