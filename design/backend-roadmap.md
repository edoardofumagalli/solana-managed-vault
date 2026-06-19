# Backend Roadmap

## Purpose

This document captures the practical roadmap that emerged after the backend
transaction-builder work and the mentor review.

It is not a replacement for:

- [backend-api-design.md](backend-api-design.md), which defines the API shape;
- [managed-vault-design.md](managed-vault-design.md), which defines the on-chain model;
- [backend-manual-testing.md](backend-manual-testing.md), which links to the local manual testing runbooks.

Use this file as the step-by-step reference for deciding what to build next.

## Current Snapshot

The backend now has a solid action-oriented foundation:

- Rust/Axum service that builds unsigned base64 `VersionedTransaction` payloads.
- Stable transaction response summary with action, vault, actor, amounts, accounts, and details.
- Optional backend simulation through `simulate: true`.
- User endpoints for deposit and asynchronous withdraw:
  - `deposit`
  - `request_withdraw`
  - `cancel_withdraw`
  - `process_withdraw`
- Manager/admin endpoints:
  - `manager_deposit`
  - `report_float_value`
  - `manager-withdraw/request`
  - `manager-withdraw/execute`
  - `emergency-shutdown`
  - `nominate-manager`
  - `accept-manager`
- Generic module endpoints:
  - `modules/register`
  - `modules/sync-nav`
  - `modules/deploy`
  - `modules/recall`
- Modular local testing scripts:
  - one fixture setup script;
  - one inspect script per tested endpoint;
  - one separate signing/sending script.
- Mock module flow verified manually through the backend:
  - fixture setup with mock module;
  - register module;
  - sync NAV;
  - deposit into the vault;
  - deploy to module;
  - recall from module.

The backend still intentionally does not sign or send user transactions. Signing
is kept in the local script or, later, in the wallet/client.

## Mentor Review Takeaways

The direction is valid:

- Action endpoints that build unsigned transactions are the right first layer.
- Keeping simulation inside the same endpoint is useful.
- The modular inspect/sign workflow is a good manual testing strategy while the
  backend surface is still evolving.
- Reading accounts from RPC is fine for the first version, especially while
  transaction construction is the main learning target.

The next important technical challenge is Kamino:

- Mock module proves the generic vault/module boundary.
- Kamino proves real protocol account routing, refreshes, oracle accounts,
  collateral accounts, and reserve-specific wiring.
- The generic module endpoints should stay generic.
- Kamino-specific helpers should produce the ordered `remainingAccounts` arrays
  required by those generic endpoints.

Simulation should later become more than a pass/fail check:

- `unitsConsumed` can be used to tune compute budget instructions.
- A future transaction builder can simulate once, estimate compute units, add
  compute budget instructions, and then return the optimized transaction.
- This is useful after the Kamino path works, because Kamino/Klend CPIs are the
  flows most likely to need compute tuning.

The read side is a separate future phase:

- For a real application, the backend should not fetch every UI-facing balance
  and state field from RPC on every request.
- Webhooks/indexing can keep a database in sync with relevant program accounts
  and events.
- Read endpoints can then serve balances, vault state, positions, ticket state,
  NAV, and user analytics from the database.

Microservices are not the first concern:

- A split between action API and read/indexing API can make sense later.
- Splitting user, manager, and module action endpoints into separate services is
  premature for now.
- Keep the current service cohesive until the read/indexing workload actually
  exists.

## Working Decisions

Keep these decisions stable unless we explicitly change the design:

- The backend builds transactions; it does not hold user private keys.
- User and manager actions return unsigned transactions for wallet signing.
- Permissionless/cranker actions still require an explicit fee payer signer.
- Localnet remains the first target.
- Surfpool is the right harness for real Kamino/Klend account tests.
- Generic module HTTP endpoints keep ordered `remainingAccounts` arrays.
- Helper scripts or fixture builders may convert friendlier named Kamino data
  into ordered `remainingAccounts`, but the endpoint contract should stay
  array-based.
- Manual scripts stay modular rather than one large E2E runner.
- Manager/admin inspect scripts remain deferred until the next higher-priority
  flows are stable.

## Kamino Account Source

The real Kamino/Klend account list should not live only inside the Surfpool
test. The test is the executable proof that the account order works, but the
backend roadmap should document the source and intended ownership of that data
so future backend scripts do not need to reverse-engineer it from the test.

For the first backend-backed Kamino flow, use a fixture or static local config
for the known USDC reserve. Full discovery is deferred.

Initial static inputs:

- `klend_program`: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- `lending_market`: `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`
- `reserve`: `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`
- `liquidity_mint`: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- `liquidity_supply_vault`: `Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6`
- `collateral_mint`: `B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D`
- `scope_prices`: `3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH`
- `lending_market_authority`: `9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo`

Initial derived inputs:

- `vault`: derived from USDC `liquidity_mint` by the vault program.
- `share_mint`: derived from `vault` by the vault program.
- `vault_token_account`: ATA for `liquidity_mint`, owned by `vault`.
- `module_call_authority`: derived by the vault program, but never included in
  client-provided `remainingAccounts`.
- `module_config`: PDA derived by the Kamino module program from `vault`.
- `kamino_module_state`: PDA derived by the Kamino module program from `vault`.
- `module_underlying_token_account`: ATA for `liquidity_mint`, owned by
  `kamino_module_state`.
- `vault_collateral_account`: ATA for `collateral_mint`, owned by
  `kamino_module_state`.
- `module_entry`: derived by the vault program from `vault`, Kamino module
  program id, and `policy_seed`.

For optional Klend oracle accounts, the current real USDC flow uses:

- `pyth_oracle`: `klend_program` placeholder
- `switchboard_price_oracle`: `klend_program` placeholder
- `switchboard_twap_oracle`: `klend_program` placeholder
- `scope_prices`: the real Scope prices account above

The placeholder rule comes from the Kamino module's reserve-oracle validation:
when the Klend reserve does not configure an optional oracle, the caller must
pass `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` in that account slot.

Kamino deploy `remainingAccounts` must be generated in this exact order:

1. `module_config`, readonly
2. `kamino_module_state`, writable
3. `reserve`, writable
4. `lending_market`, readonly
5. `lending_market_authority`, readonly
6. `pyth_oracle`, readonly
7. `switchboard_price_oracle`, readonly
8. `switchboard_twap_oracle`, readonly
9. `scope_prices`, readonly
10. `liquidity_mint`, readonly
11. `liquidity_supply_vault`, writable
12. `collateral_mint`, writable
13. `module_underlying_token_account`, writable
14. `vault_collateral_account`, writable
15. `token_program`, readonly
16. `liquidity_token_program`, readonly
17. `klend_program`, readonly
18. `instruction_sysvar`, readonly

Kamino recall `remainingAccounts` must be generated in this exact order:

1. `module_config`, readonly
2. `kamino_module_state`, writable
3. `lending_market`, readonly
4. `reserve`, writable
5. `lending_market_authority`, readonly
6. `pyth_oracle`, readonly
7. `switchboard_price_oracle`, readonly
8. `switchboard_twap_oracle`, readonly
9. `scope_prices`, readonly
10. `liquidity_mint`, readonly
11. `collateral_mint`, writable
12. `liquidity_supply_vault`, writable
13. `vault_collateral_account`, writable
14. `module_underlying_token_account`, writable
15. `vault_token_account`, writable
16. `token_program`, readonly
17. `liquidity_token_program`, readonly
18. `klend_program`, readonly
19. `instruction_sysvar`, readonly

All generated remaining accounts must use `isSigner: false` until the backend
response contract supports extra module-specific signers.

Discovery comes later. A production discovery layer should read reserve config
and derive or validate the reserve, market, authority, mints, supply vaults,
oracle accounts, and token accounts instead of relying on hardcoded USDC
fixtures.

## Kamino Backend Flow Decision

Use the existing generic endpoints first:

- `POST /transactions/modules/register`
- `POST /transactions/modules/deploy`
- `POST /transactions/modules/recall`
- `POST /transactions/modules/sync-nav`

Generate Kamino-specific `remainingAccounts` from fixture/static config in
scripts or fixture helpers, then submit those arrays to the generic endpoints.

This keeps the backend's module contract honest: the vault program is generic,
so the backend should first prove that the generic HTTP surface can drive a real
module. It also avoids adding a second endpoint family before we know which
parts are truly reusable.

Dedicated Kamino helper endpoints can be added later if they provide clear UX or
safety value. Good reasons would be:

- the frontend should provide only `vault`, `manager`, `reserve`, and `amount`;
- the backend should fetch reserve/oracle config and build the account list;
- the backend should validate Kamino reserve metadata before building;
- the backend should add Kamino-specific compute budget policy.

Until then, the first implementation should be:

```text
Kamino fixture/static config
    -> fixture helper generates ordered remainingAccounts
    -> generic modules/deploy or modules/recall endpoint
    -> unsigned VersionedTransaction response
    -> existing manual signing script
```

## Immediate Roadmap

### 1. Kamino Backend Design

Goal: define exactly how the backend will support the existing Kamino adapter
without breaking the generic module endpoint model.

Steps:

1. Re-read the Kamino module Anchor accounts for `initialize`, `calculate_nav`,
   `deposit`, and `withdraw`.
2. Re-read the Surfpool real USDC flow and extract the account order currently
   proven by tests.
3. Document the Kamino account source:
   - fixture/static config first;
   - discovery later.
4. Decide whether the first backend flow uses:
   - generic `modules/deploy` and `modules/recall` plus Kamino fixture-generated
     `remainingAccounts`;
   - or dedicated Kamino helper endpoints that wrap the generic endpoint shape.
5. Update [backend-api-design.md](backend-api-design.md) only where the API
   contract itself changes.

Definition of done:

- We know the exact JSON fields needed for a Kamino USDC fixture.
- We know the ordered `remainingAccounts` for Kamino deploy and recall.
- We know whether any extra endpoint is needed before implementation.

### 2. Kamino Fixture And Account Routing

Goal: produce reliable Kamino request payloads for the backend.

Steps:

1. Add or extend fixture support for a known Kamino/Klend USDC reserve.
2. Store enough account data to build:
   - register module request;
   - optional module NAV refresh request if needed;
   - deploy `remainingAccounts`;
   - recall `remainingAccounts`.
3. Keep account labels for readability, but preserve exact account order.
4. Validate that no extra signer is required in `remainingAccounts` for the
   first backend version.

Definition of done:

- The fixture can generate backend-compatible Kamino deploy and recall request
  payloads.
- The account list matches the Kamino module Anchor instruction order.

### 3. Kamino Manual Inspect Flow

Goal: test Kamino transaction construction through the backend the same way the
mock module was tested.

Steps:

1. Add inspect scripts or fixture modes for Kamino register/sync/deploy/recall.
2. Run them against Surfpool with real cloned Kamino/Klend accounts.
3. Save transaction builds under `.tmp/`.
4. Review decoded account metas and simulation logs.
5. Sign/send only through the existing explicit signing script.

Definition of done:

- Backend can build and simulate Kamino deploy.
- Backend can build and simulate Kamino recall.
- Signed/sent Surfpool flow succeeds locally.

### 4. Backend Cleanup Pass

Goal: improve maintainability after the Kamino path exposes real complexity.

Candidate cleanup areas:

- reduce repeated route boilerplate for blockhash plus vault fetch;
- separate account resolution helpers more clearly from instruction builders;
- make transaction summary construction less repetitive;
- improve structured error codes beyond the current broad categories;
- document endpoint examples once request shapes stabilize.

Do this after Kamino construction works, not before. Refactoring before the
hardest account-routing path is proven could optimize the wrong shape.

### 5. Compute Budget Tuning

Goal: use simulation results to return better transactions.

Steps:

1. Capture `unitsConsumed` from simulation for each endpoint.
2. Add a compute unit margin policy.
3. Add Solana Compute Budget instructions before the vault instruction.
4. Rebuild and re-simulate the final transaction when needed.
5. Keep the summary explicit about compute budget settings.

Definition of done:

- High-CPI flows such as Kamino deploy/recall request enough compute units.
- Low-CU flows can avoid relying on the default compute budget.

### 6. Read API And Indexing Design

Goal: move from transaction-building only to app-facing data.

Steps:

1. Decide the first read endpoints:
   - vault overview;
   - user position;
   - token balances;
   - pending withdraw tickets;
   - module NAV state;
   - manager float state.
2. Decide whether the first version reads directly from RPC or from a local DB.
3. Design an indexing/webhook pipeline for later:
   - listen to relevant program activity;
   - update database state;
   - serve read endpoints from the DB.
4. Keep the action API independent from the read API boundary.

Definition of done:

- Frontend-facing read requirements are explicit.
- We know which data still needs live RPC and which data can be indexed.

### 7. Deployment And Operations

Goal: make the backend runnable outside local development.

Steps:

1. Define environments:
   - localnet;
   - devnet or Surfpool-style integration;
   - eventual mainnet.
2. Add config handling for RPC URLs, program IDs, and known fixture accounts.
3. Decide deployment target later:
   - VPS;
   - Railway;
   - DigitalOcean;
   - AWS or similar.
4. Add basic observability:
   - request logs;
   - simulation failures;
   - RPC errors;
   - transaction build metrics.

Definition of done:

- The backend can run with explicit environment config outside a local shell.
- Cluster selection is visible and cannot silently switch.

## Deferred On Purpose

These are useful, but not the next move:

- Full production auth model.
- Backend-held signer for automated cranking.
- Manager/admin inspect scripts.
- Address lookup table optimization.
- Full Kamino account discovery for every reserve.
- Database-backed read API.
- Microservice split.
- Mainnet deployment.

## Next Concrete Step

Start with **Kamino Backend Design**.

The first implementation task should be a read-only analysis pass:

1. Inspect `kamino_yield_module` instruction account structs.
2. Inspect `tests/surfpool/kamino/real_usdc_flow.ts`.
3. Map the proven Surfpool accounts into backend request JSON.
4. Decide whether to add only fixture/script helpers first or a backend
   Kamino-specific helper layer.

Only after that mapping is clear should we modify backend code.
