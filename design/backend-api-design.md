# Backend API Design

## 1. Purpose

The backend is an off-chain Rust API that builds Solana transactions for the managed vault.

Its main job is to hide Solana account derivation and transaction construction from the client. A frontend or script should be able to send a small request such as "deposit this amount into this vault for this user" and receive a transaction that is ready to be signed by the correct wallet.

The backend does not replace on-chain validation. The Anchor programs remain the source of truth. Backend checks are only used to improve UX, fail earlier, and reduce invalid transactions.

## 2. Mental Model

The backend is not another Solana program. It is a normal HTTP service.

The flow is:

```text
client request
    -> Rust backend derives/reads accounts
    -> Rust backend builds a Solana transaction
    -> backend returns the unsigned transaction
    -> client wallet signs it
    -> client sends it on-chain
    -> vault program executes the instruction
```

The backend creates the transaction, but the user's wallet still authorizes the action by signing it.

For the first version, the backend should not hold user private keys and should not submit user transactions. It should only return transactions for the client to sign and send.

## 3. Non-Goals For The First Version

The first backend version should not try to be a full production service.

Out of scope initially:

- User authentication beyond public key based request validation.
- Mainnet deployment.
- Indexing all vault history.
- Complex database state.
- Automated strategy management.
- Backend-owned signing for user actions.
- Address lookup table optimization.
- Full Kamino account discovery for every possible reserve.

The first goal is a clean transaction-building API for the main vault actions.

## 4. Response Contract

Every transaction-building endpoint should return the same response shape.

Proposed response:

```json
{
  "transaction": "<base64 serialized VersionedTransaction>",
  "requiredSigners": ["<wallet public key>"],
  "feePayer": "<fee payer public key>",
  "recentBlockhash": "<blockhash>",
  "lastValidBlockHeight": 123,
  "computeBudget": {
    "mode": "auto",
    "requestedUnits": 90200,
    "estimatedUnits": 82000,
    "marginBps": 1000,
    "microLamports": "0"
  },
  "summary": {
    "action": "deposit",
    "vault": "<vault public key>",
    "actor": {
      "role": "user",
      "address": "<user public key>"
    },
    "amounts": [
      {
        "kind": "underlying",
        "raw": "1000000"
      }
    ],
    "accounts": [
      {
        "role": "underlying_mint",
        "address": "<underlying mint public key>"
      },
      {
        "role": "share_mint",
        "address": "<share mint public key>"
      }
    ]
  }
}
```

The transaction should be unsigned or only partially signed by backend-controlled operational signers if such signers are introduced later.

For user actions, the transaction is returned unsigned and must be signed by the user's wallet.

For permissionless or cranker actions, the API should still require an explicit `feePayer` input. This wallet is not treated as a vault authority; it only signs the outer Solana transaction so the transaction can pay network fees. When the Anchor instruction has a non-privileged signer account such as `executor` or `cranker`, the backend should use the same public key as both the instruction signer account and the transaction fee payer unless a later endpoint explicitly supports multiple signers.

The response includes a human-readable `summary` so clients can display what the user is about to sign.

The summary should use a stable common shape across all transaction builders:

- `action`: enum-like action name serialized as `snake_case`, such as `deposit`, `request_withdraw`, or `sync_module_nav`.
- `vault`: the vault public key affected by the action.
- `actor`: optional primary actor for the instruction, such as `user`, `manager`, `emergency_admin`, `cranker`, or `withdraw_user`.
- `amounts`: optional list of raw integer amounts. Each amount has a `kind`, such as `underlying`, `shares`, `reported_float_value`, or `module_underlying`.
- `accounts`: optional list of important semantic accounts, such as `underlying_mint`, `share_mint`, `receiver_token_account`, `module_entry`, or `module_program`.
- `details`: optional string map for small identifiers that are not accounts or amounts, such as `ticketIndex`, `requestId`, or `policySeed`.

The optional `computeBudget` object describes compute budget instructions added
by the backend. It is separate from `summary` because it is transaction envelope
metadata rather than vault business intent. Clients can display it as an
execution-cost detail, while keeping action summaries stable across endpoints.

## 5. Who Signs And Who Sends

Signing rules should match the Anchor account constraints.

| Action                        | Required signer                                          | Who sends the transaction           |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------- |
| `deposit`                     | User/depositor                                           | Client wallet                       |
| `request_withdraw`            | User                                                     | Client wallet                       |
| `cancel_withdraw`             | User                                                     | Client wallet                       |
| `process_withdraw`            | Transaction fee payer only                               | Client, backend, or cranker         |
| `manager_deposit`             | Caller returning funds                                   | Client wallet or operational wallet |
| `request_manager_withdraw`    | Manager                                                  | Manager wallet                      |
| `execute_manager_withdraw`    | Permissionless executor signer; use fee payer by default | Manager, backend, or cranker        |
| `report_float_value`          | Manager                                                  | Manager wallet                      |
| `register_module`             | Manager                                                  | Manager wallet                      |
| `deploy_to_module`            | Manager                                                  | Manager wallet                      |
| `recall_from_module`          | Manager                                                  | Manager wallet                      |
| `sync_module_nav`             | Permissionless cranker signer; use fee payer by default  | Client, backend, or cranker         |
| `nominate_manager`            | Current manager                                          | Manager wallet                      |
| `accept_manager`              | Pending manager                                          | Pending manager wallet              |
| `activate_emergency_shutdown` | Emergency admin                                          | Emergency admin wallet              |

The backend may eventually send permissionless cranking transactions itself, but this should be a separate mode with a clearly configured backend signer.

## 6. Minimal Client Inputs

The API should ask the client for the smallest useful set of data.

The backend should derive PDA accounts, associated token accounts, and module accounts whenever possible.

### Common Inputs

Most endpoints need:

```json
{
  "vault": "<vault public key>",
  "wallet": "<signer public key>",
  "amount": "<integer string>"
}
```

Amounts should be strings in API JSON to avoid JavaScript number precision issues.

Permissionless or cranker endpoints use `feePayer` instead of `wallet` when there is no privileged role signer:

```json
{
  "vault": "<vault public key>",
  "feePayer": "<wallet public key>"
}
```

If the on-chain account list contains a non-privileged signer such as `executor` or `cranker`, the first backend version should set that account to `feePayer`. This keeps the response's `requiredSigners` list simple and avoids asking the client for two signatures when one fee-paying wallet is enough.

### Common Transaction Options

All transaction-building endpoints may accept shared transaction options in
addition to endpoint-specific fields.

Simulation remains controlled by `simulate`:

```json
{
  "simulate": true
}
```

Compute budget behavior should be controlled by a nested `computeBudget` object:

```json
{
  "computeBudget": {
    "mode": "auto",
    "marginBps": 1000,
    "microLamports": "0"
  }
}
```

Supported first-version modes:

- `none`: do not add compute budget instructions. This is the default for
  backwards compatibility with the current backend.
- `auto`: estimate compute usage through backend simulation, add a margin, and
  prepend a `SetComputeUnitLimit` instruction to the returned transaction.
- `fixed`: use a caller-provided `unitLimit` and prepend a
  `SetComputeUnitLimit` instruction without estimation.

Recommended request shape:

```json
{
  "computeBudget": {
    "mode": "fixed",
    "unitLimit": 300000,
    "microLamports": "1000"
  }
}
```

Field rules:

- `mode` is optional and defaults to `none`.
- `unitLimit` is required for `fixed` mode and rejected for `auto` mode unless a
  later version explicitly supports max caps.
- `marginBps` is only used by `auto` mode. It defaults to `1000` basis points
  (10%) and should be bounded by backend validation.
- `microLamports` is optional. When present and greater than zero, the backend
  prepends a `SetComputeUnitPrice` instruction in addition to the compute unit
  limit instruction. Use a string because priority-fee inputs are u64-like
  values and JavaScript clients should not rely on number precision.
- Compute budget instructions must always be inserted before the vault
  instruction and before any other non-compute-budget instruction.

### Endpoint Inputs

| Endpoint                                      | Minimal request data                                                                             | Backend derives or reads                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /transactions/deposit`                  | `vault`, `user`, `amount`                                                                        | Vault state, underlying mint, share mint, vault token account, user underlying ATA, user share ATA                                                     |
| `POST /transactions/request-withdraw`         | `vault`, `user`, `sharesAmount`                                                                  | Vault state, share mint, user share ATA, user position PDA, next ticket PDA, escrow share token account                                                |
| `POST /transactions/cancel-withdraw`          | `vault`, `user`, `ticketIndex`                                                                   | Withdraw ticket PDA, escrow share token account, user share ATA                                                                                        |
| `POST /transactions/process-withdraw`         | `vault`, `user`, `ticketIndex`, `feePayer`                                                       | Withdraw ticket PDA, user position PDA, escrow share token account, share mint, vault token account, user underlying ATA                               |
| `POST /transactions/manager-deposit`          | `vault`, `caller`, `amount`, optional source token account                                       | Vault state, vault token account, underlying mint, caller underlying ATA if source not provided                                                        |
| `POST /transactions/manager-withdraw/request` | `vault`, `manager`, `amount`, `receiverTokenAccount`                                             | Manager withdraw request PDA, vault token account, vault state                                                                                         |
| `POST /transactions/manager-withdraw/execute` | `vault`, `requestId`, `feePayer`                                                                 | Manager withdraw request PDA, vault token account, receiver token account from request; backend uses `feePayer` as executor                            |
| `POST /transactions/report-float-value`       | `vault`, `manager`, `reportedFloatValue`                                                         | Vault state, vault token account                                                                                                                       |
| `POST /transactions/modules/register`         | `vault`, `manager`, `moduleProgram`, `moduleState`, `moduleUnderlyingTokenAccount`, `policySeed` | Module entry PDA and vault state                                                                                                                       |
| `POST /transactions/modules/deploy`           | `vault`, `manager`, `moduleEntry`, `amount`, `remainingAccounts`                                 | Vault state, module entry, module call authority PDA, module program, module underlying token account, remaining accounts for module `deposit(amount)` |
| `POST /transactions/modules/recall`           | `vault`, `manager`, `moduleEntry`, `amount`, `remainingAccounts`                                 | Vault state, module entry, module call authority PDA, module program, vault token account, remaining accounts for module `withdraw(amount)`            |
| `POST /transactions/modules/sync-nav`         | `vault`, `moduleEntry`, `feePayer`                                                               | Vault state, module entry, module state, module program; backend uses `feePayer` as cranker                                                            |
| `POST /transactions/emergency-shutdown`       | `vault`, `emergencyAdmin`                                                                        | Vault state                                                                                                                                            |
| `POST /transactions/nominate-manager`         | `vault`, `manager`, `newManager`                                                                 | Vault state; backend pre-checks that `manager` is the current manager                                                                                  |
| `POST /transactions/accept-manager`           | `vault`, `pendingManager`                                                                        | Vault state; backend pre-checks that `pendingManager` is the currently nominated pending manager                                                       |

For Kamino-specific module endpoints, the backend may also need reserve, market, oracle, collateral mint, liquidity supply, and token accounts. In the first version these can be read from configuration or fixtures before a full discovery layer exists.

### Module Remaining Accounts

`deploy_to_module` and `recall_from_module` are generic vault instructions. The vault instruction has its own fixed account list, then forwards `remaining_accounts` as the account list for the external module CPI.

The backend should represent those forwarded accounts as an ordered AccountMeta-like JSON array:

```json
{
  "remainingAccounts": [
    {
      "pubkey": "<account public key>",
      "isWritable": true,
      "isSigner": false,
      "role": "kamino_module_state"
    }
  ]
}
```

Field rules:

- `pubkey` is required and must parse as a Solana public key.
- `isWritable` is required and maps directly to Solana `AccountMeta::new` versus `AccountMeta::new_readonly`.
- `isSigner` is required, but the first backend version should reject `true`. If a future module needs extra external signers, the response contract must also add those signers to `requiredSigners`.
- `role` is optional and only for human-readable inspection, fixture readability, and transaction summaries. The backend must not use `role` as a security boundary.

Order matters. The backend must preserve `remainingAccounts` exactly as the client or fixture supplies it, because the external module owns its own Anchor account order. A map keyed by role would be easier to read, but it would lose ordering guarantees and would not fit the generic module interface.

The backend should still validate the minimum generic invariants before returning a transaction:

- Fetch `ModuleEntry` from RPC and verify it belongs to the requested vault, is active, and is bound to the stored module program.
- For deploy, require `remainingAccounts` to include `ModuleEntry.module_state`.
- For deploy, require `remainingAccounts` to include `ModuleEntry.module_underlying_token_account`, because the module `deposit(amount)` CPI must see the staging token account after the vault has transferred underlying into it.
- For recall, require `remainingAccounts` to include `ModuleEntry.module_state`.
- For recall, require `remainingAccounts` to include the vault token account, because the module `withdraw(amount)` CPI must return underlying into the vault.

Some accounts intentionally appear both in the vault instruction's fixed account list and in `remainingAccounts`. For example, deploy has a fixed `module_underlying_token_account` account for the vault transfer, and the same account may also be required by the module deposit CPI. Recall has the same pattern for `vault_token_account`. This duplication is expected: the fixed accounts are for the vault instruction, while `remainingAccounts` is the forwarded CPI account list.

Do not include `module_call_authority` in client-provided `remainingAccounts`. The vault core instruction derives it, prepends it to the module CPI account metas, and signs for it with PDA seeds. Do not include `module_program` as a remaining account either; it is the CPI program id and a fixed vault instruction account.

`sync_module_nav` is different. The current on-chain instruction does not accept `remaining_accounts`; it reads the standard cached NAV header from `ModuleEntry.module_state`. If a module needs a protocol-specific NAV refresh first, such as Kamino `calculate_nav`, that should be handled by a separate module-specific transaction builder or script before calling the generic vault `sync-nav` endpoint.

## 7. Account Resolution Strategy

The backend should use three account resolution methods.

### Derived Accounts

These are deterministic and should not be provided by the client:

- Vault PDA, if the request starts from an underlying mint instead of a vault.
- Share mint PDA.
- User position PDA.
- Withdraw ticket PDA.
- Escrow share token account PDA.
- Manager withdraw request PDA.
- Module entry PDA.
- Module call authority PDA.
- Associated token accounts.

### Read From Chain

These should be fetched from RPC because the vault or module stores them:

- Vault state.
- Underlying mint.
- Share mint.
- Vault token account.
- Manager.
- Emergency admin.
- Module entry.
- Module state.
- Module underlying token account.
- Cached NAV fields.

### Configured Or Fixture Accounts

These can start as backend config and later become discovery logic:

- Known program IDs.
- Kamino/Klend program ID.
- Kamino lending market.
- Kamino reserve.
- Reserve liquidity mint.
- Reserve collateral mint.
- Reserve liquidity supply.
- Lending market authority.
- Oracle accounts.

## 8. Backend Architecture

Recommended initial Rust stack:

- `axum` for HTTP routing.
- `tokio` for async runtime.
- Solana RPC client for account reads and blockhash fetching.
- Solana SDK types for transaction construction.
- Anchor-generated Rust types where practical, so account metas and instruction data stay aligned with the on-chain program.

Suggested modules:

```text
backend/
  src/
    main.rs
    config.rs
    error.rs
    routes/
      mod.rs
      transactions.rs
      health.rs
    services/
      rpc.rs
      account_resolver.rs
      transaction_builder.rs
    builders/
      deposit.rs
      withdraw.rs
      manager.rs
      modules.rs
      admin.rs
```

The important split is:

- Routes parse HTTP input.
- Account resolver derives and fetches accounts.
- Builders create instructions.
- Transaction builder wraps instructions into a `VersionedTransaction`.

## 9. Endpoint Groups

### Public User Endpoints

These build transactions for normal vault users:

- `deposit`
- `request_withdraw`
- `cancel_withdraw`
- `process_withdraw`

`process_withdraw` is not a normal user signature flow, but it is still user-facing because it completes a user's withdrawal ticket.

### Manager Endpoints

These build transactions requiring the manager or an executor:

- `manager_deposit`
- `request_manager_withdraw`
- `execute_manager_withdraw`
- `report_float_value`
- `deploy_to_module`
- `recall_from_module`
- `register_module`
- `nominate_manager`
- `accept_manager`

The backend can pre-check that the provided signer matches the vault manager where appropriate.

### Admin Endpoint

Emergency shutdown is separated because it uses the emergency admin, not necessarily the manager:

- `activate_emergency_shutdown`

### Crank Endpoints

These can be permissionless or backend-operated later:

- `sync_module_nav`
- eventually `process_withdraw`
- eventually scheduled health checks and NAV refreshes

In the client-built mode, these endpoints should return unsigned transactions with `requiredSigners = [feePayer]`. In a later backend-operated mode, the service can choose a configured backend signer as the fee payer and submit the transaction itself, but that is a separate policy from user transaction building.

## 10. Validation Rules

The backend should perform helpful validation before returning a transaction:

- The vault account exists and is owned by the vault program.
- The requested signer matches the expected role for manager/admin actions.
- The amount is positive.
- The token accounts use the expected mint.
- Module entries match the requested vault and module program.
- Kamino accounts match the configured reserve and market.
- Emergency shutdown state is checked for blocked actions.

These checks improve UX, but on-chain constraints must still enforce correctness.

## 11. Simulation

The backend can optionally simulate the built transaction before returning it.

Simulation is useful because the backend can catch missing accounts, wrong mints, stale module state, or insufficient liquidity before the user signs.

For the first version, simulation can be optional and controlled by a request flag:

```json
{
  "simulate": true
}
```

If simulation is enabled, the response can include:

```json
{
  "simulation": {
    "ok": true,
    "logs": []
  }
}
```

Diagnostic simulation and compute budget estimation are related but distinct:

- Diagnostic simulation is controlled by `simulate` and is returned to the
  caller in the `simulation` response object.
- Compute budget estimation is an internal build step used only when
  `computeBudget.mode = "auto"`. It may run even when `simulate = false`.
- If both are requested, the backend should estimate first, build the final
  transaction with compute budget instructions, then optionally simulate the
  final transaction for the user-facing response.

## 12. Compute Budget Policy

Solana transactions have a compute budget: the maximum compute units (CUs) the
runtime may spend executing the transaction. If the transaction consumes more
than its requested limit, execution fails with compute exhaustion. If the
transaction requests far more CUs than it needs, it can be less efficient for
scheduling and can overpay when a priority fee is attached.

The backend should support compute budget tuning as a transaction-envelope
feature, not as endpoint-specific business logic. Every endpoint already ends
with the same operation: wrap one or more Solana instructions into an unsigned
`VersionedTransaction`. Compute budget handling should live in the shared
transaction services so user, manager, admin, and module endpoints all inherit
the same behavior.

### Why The Backend Should Own This First

The backend already has the complete instruction list, the fee payer, the recent
blockhash, and the RPC client needed for simulation. A browser client could also
estimate compute, but making the backend produce the final unsigned transaction
keeps the client contract simple:

```text
client describes desired vault action
    -> backend resolves accounts and estimates compute if requested
    -> backend returns the final unsigned transaction
    -> wallet signs exactly that final transaction
```

This also matters because changing the compute unit limit changes the
transaction message. A wallet must sign the final message after compute budget
instructions have been inserted.

### Modes

`none` mode:

- Preserve current behavior.
- Do not add `SetComputeUnitLimit` or `SetComputeUnitPrice`.
- Use this as the default until the feature is verified across endpoints.

`fixed` mode:

- Add `SetComputeUnitLimit(unitLimit)` before the vault instruction.
- Optionally add `SetComputeUnitPrice(microLamports)` before the vault
  instruction.
- Do not simulate for estimation.
- Useful for deterministic local experiments, manual testing, and debugging a
  known Kamino/Klend flow.

`auto` mode:

- Build a provisional transaction for estimation.
- Include a high `SetComputeUnitLimit` in the provisional transaction so the
  estimate itself is less likely to fail from compute exhaustion.
- Simulate the provisional transaction with signature verification disabled.
- Require a successful simulation and a non-empty `unitsConsumed` value.
- Compute the final requested units as:

```text
requested_units = ceil(estimated_units * (10_000 + margin_bps) / 10_000)
```

- Clamp `requested_units` to Solana's transaction maximum.
- Rebuild the final unsigned transaction with `SetComputeUnitLimit` prepended.
- Optionally prepend `SetComputeUnitPrice` when `microLamports > 0`.

For the first backend version, `auto` should fail closed if estimation fails.
Silently falling back to a broad default would make debugging harder and could
hide account-routing or CPI issues, especially in Kamino flows.

### Response Metadata

When compute budget instructions are added, the response should include a
top-level `computeBudget` object:

```json
{
  "computeBudget": {
    "mode": "auto",
    "requestedUnits": 90200,
    "estimatedUnits": 82000,
    "marginBps": 1000,
    "microLamports": "0"
  }
}
```

Field meanings:

- `mode`: effective mode used by the backend.
- `requestedUnits`: final compute unit limit inserted into the transaction.
- `estimatedUnits`: simulation result used by `auto` mode. Omitted for `fixed`
  mode.
- `marginBps`: margin used by `auto` mode. Omitted for `fixed` mode unless the
  backend wants to surface a default.
- `microLamports`: compute unit price inserted into the transaction. Use `"0"`
  when no priority fee instruction was added or omit it if the implementation
  prefers sparse output.

This object is intentionally separate from `simulation`. `simulation` describes
the result of simulating a transaction. `computeBudget` describes how the final
transaction was constructed.

### Priority Fee Scope

The first version should support caller-provided `microLamports` but should not
attempt dynamic priority fee discovery. Dynamic priority fee selection depends
on production RPC providers, market conditions, and endpoint policy. That is a
separate operational concern from correctly estimating compute unit limits.

Later versions can add:

- backend config defaults per cluster;
- endpoint-specific defaults for known heavy flows such as Kamino deploy/recall;
- dynamic priority fee providers;
- backend-operated cranker policies for permissionless endpoints.

### Rollout Strategy

Start with opt-in compute budget tuning:

```json
{
  "computeBudget": {
    "mode": "auto"
  }
}
```

Keep default mode as `none` while testing. This avoids changing the behavior of
all endpoints at once and keeps existing manual scripts valid.

Suggested verification order:

1. `deposit`, because it is simple and already well understood.
2. `request_withdraw` or `process_withdraw`, because they exercise more account
   resolution without external protocol CPIs.
3. Mock `modules/deploy`, because it exercises the generic module dispatch path.
4. Kamino `modules/deploy`, because it is the first heavy real CPI flow.
5. Kamino `modules/recall`, once deploy tuning is stable.

After the feature is verified, consider defaulting selected heavy endpoints to
`auto` through backend config while keeping request-level overrides for manual
debugging.

### Implementation Shape

Keep endpoint builders focused on business instructions. They should not know
how to estimate compute. The shared transaction layer should accept:

- fee payer;
- required signers;
- recent blockhash;
- business instructions;
- compute budget request;
- optional diagnostic simulation flag.

The shared layer should then:

1. Build the business-only instruction list.
2. Estimate compute if requested.
3. Prepend compute budget instructions.
4. Build the final unsigned `VersionedTransaction`.
5. Optionally simulate the final transaction for the response.
6. Return the standard transaction response plus optional compute budget
   metadata.

This keeps the future migration path manageable. If the backend later supports
address lookup tables, backend-operated crankers, or dynamic priority fees, the
same shared transaction layer remains the right extension point.

## 13. Error Model

The API should return structured errors.

Example:

```json
{
  "error": {
    "code": "INVALID_MANAGER",
    "message": "The provided signer is not the current vault manager.",
    "details": {
      "expected": "<manager pubkey>",
      "received": "<request signer>"
    }
  }
}
```

Useful error categories:

- `BAD_REQUEST`
- `ACCOUNT_NOT_FOUND`
- `INVALID_ACCOUNT_OWNER`
- `INVALID_SIGNER_ROLE`
- `INVALID_AMOUNT`
- `VAULT_SHUTDOWN`
- `MODULE_NOT_REGISTERED`
- `KAMINO_ACCOUNT_MISMATCH`
- `SIMULATION_FAILED`
- `COMPUTE_BUDGET_ESTIMATION_FAILED`
- `INVALID_COMPUTE_BUDGET`
- `RPC_ERROR`

## 14. Security Notes

The backend must not be treated as a security boundary for vault funds.

Important rules:

- Never ask users for private keys.
- Never store user private keys.
- Always return a transaction summary so the client can show what will be signed.
- Do not rely only on backend validation for manager/admin permissions.
- Validate account ownership before deserializing account data.
- Treat RPC data as untrusted.
- Keep clusters explicit: localnet, devnet, mainnet.
- Avoid silently switching clusters.

If a backend signer is introduced later for cranking, it should be scoped to permissionless operations and configured separately from user flows.

## 15. Implementation Plan

### Phase 1: Skeleton

1. Create a new Rust backend crate.
2. Add `axum`, `tokio`, Solana SDK/RPC dependencies, and config loading.
3. Add `GET /health`.
4. Add static config for cluster, RPC URL, and program IDs.

### Phase 2: First Transaction Builder

1. Implement account resolver for vault state.
2. Implement `POST /transactions/deposit`.
3. Return a base64 serialized unsigned versioned transaction.
4. Support optional `simulate: true` for deposit transactions, using unsigned transactions with signature verification disabled.
5. Add a small client script that calls the endpoint and prints the decoded transaction summary, including static account metas and compiled instruction data.

### Phase 2.1: Shared Transaction Utilities

Before adding more endpoint families, extract the repeated transaction-building pieces introduced by the deposit endpoint:

1. Move unsigned `VersionedTransaction` wrapping, placeholder signatures, base64 serialization, and required-signer metadata into a shared transaction builder helper.
2. Move optional simulation into a shared service so all endpoints return simulation summaries consistently.
3. Keep endpoint-specific builders focused on account resolution and Anchor instruction construction.
4. Preserve the user-wallet fee-payer model for normal user actions.
5. Use an explicit `feePayer` input for permissionless/cranker actions such as `process_withdraw`, because Solana transactions still require a fee payer signer even when the on-chain instruction has no user signer.

### Phase 2.2: Manual Transaction Testing Utilities

Keep local backend testing modular instead of building one large end-to-end script:

1. Add a dedicated backend fixture setup script that prepares localnet state and writes a fixture JSON file. This replaces the earlier ad-hoc direct on-chain setup flow for backend endpoint testing.
2. Keep one inspect script per backend endpoint. Each script calls the endpoint, prints the backend summary, decodes the returned `VersionedTransaction`, and can save the raw build response with `--output`.
3. Store local script outputs under `.tmp/`, which is ignored by git.
4. Use one separate signing script for saved backend transaction builds. By default it only reviews and validates the saved response; explicit flags are required to sign or send.
5. Before signing, the script must verify the saved response schema, required signer, fee payer, transaction blockhash, and `lastValidBlockHeight`.
6. Before sending, the script must simulate the signed transaction and abort if simulation fails.
7. If the saved blockhash is close to expiry, rebuild the transaction by rerunning the relevant inspect script instead of replacing the blockhash locally.
8. Keep the runnable manual workflow documented via [`backend-manual-testing.md`](backend-manual-testing.md) and extend the split runbooks under [`testing/README.md`](testing/README.md) as each new endpoint family is added.

### Phase 3: User Withdraw Builders

1. Add `request_withdraw`.
2. Add `cancel_withdraw`.
3. Add `process_withdraw`.
4. Reuse the shared simulation service from Phase 2.1 for each withdraw endpoint.

### Phase 4: Manager And Admin Builders

Build the manager/admin endpoints in a liquidity-first order. This keeps the backend useful for the user-withdraw flow before adding the full manager withdrawal timelock surface.

1. Add shared role and request helpers for manager/admin endpoints:
   - reusable pubkey and positive-u64 parsing;
   - a manager role pre-check that compares the requested signer with `vault.manager`;
   - an emergency-admin pre-check that compares the requested signer with `vault.emergency_admin`;
   - shared response-summary conventions for manager, caller, executor, and emergency-admin actors.
2. Add `POST /transactions/manager-deposit`:
   - request: `vault`, `caller`, `amount`, optional `sourceTokenAccount`, optional `simulate`;
   - signer and fee payer: `caller`;
   - default `sourceTokenAccount` to the caller's underlying ATA when omitted;
   - do not enforce manager role because the on-chain instruction is intentionally permissionless;
   - include `underlying`, `underlying_mint`, `caller_underlying_token_account`, and `vault_token_account` in the summary.
3. Defer manager/admin manual inspect scripts until after this endpoint surface is stable:
   - do not add manager/admin inspect scripts in this phase;
   - keep the current manual scripts focused on the deposit and user-withdraw flow;
   - later extend the manual testing runbooks under `design/testing/` and add one inspect script per manager/admin endpoint.
4. Add `POST /transactions/report-float-value`:
   - request: `vault`, `manager`, `reportedFloatValue`, optional `simulate`;
   - signer and fee payer: `manager`;
   - backend pre-checks that `manager == vault.manager`;
   - keep it allowed during emergency shutdown, matching on-chain behavior;
   - include `reported_float_value`, `underlying_mint`, and `vault_token_account` in the summary.
5. Add `POST /transactions/manager-withdraw/request`:
   - request: `vault`, `manager`, `amount`, `receiverTokenAccount`, optional `simulate`;
   - signer and fee payer: `manager`;
   - backend pre-checks that `manager == vault.manager`;
   - derive `manager_withdraw_request` from `vault.next_manager_withdraw_request_id`;
   - include `requestId`, `managerWithdrawDelaySlots`, and `receiver_token_account` in the summary.
6. Add `POST /transactions/manager-withdraw/execute`:
   - request: `vault`, `requestId`, `feePayer`, optional `simulate`;
   - signer and fee payer: `feePayer`, used as the permissionless on-chain `executor`;
   - fetch and validate the `ManagerWithdrawRequest` account before building;
   - read the receiver token account from the request account rather than asking the client to resubmit it;
   - include `requestId`, `executor`, `receiver_token_account`, and `underlying` amount in the summary.
7. Add `POST /transactions/emergency-shutdown`:
   - request: `vault`, `emergencyAdmin`, optional `simulate`;
   - signer and fee payer: `emergencyAdmin`;
   - backend pre-checks that `emergencyAdmin == vault.emergency_admin`;
   - keep this endpoint separate from manager endpoints because the authority role is different.
8. Add `nominate_manager` and `accept_manager` after the core manager float and emergency flows:
   - `nominate_manager` is signed by the current manager and carries `newManager`;
   - `accept_manager` is signed by the pending manager;
   - both should use the same transaction response shape;
   - manual inspect scripts for these endpoints are deferred with the other manager/admin scripts.

### Phase 5: Module Builders

1. Add shared module request helpers:
   - parse `moduleEntry`, `moduleProgram`, `moduleState`, `moduleUnderlyingTokenAccount`, and `policySeed`;
   - parse `remainingAccounts` into ordered Solana account metas;
   - reject `remainingAccounts[*].isSigner = true` in the first version;
   - preserve optional `role` labels for summaries and debugging only.
2. Add module account resolvers:
   - derive the `module_entry` PDA for `register_module`;
   - fetch and deserialize `ModuleEntry` for deploy, recall, and sync-nav;
   - validate that the module entry belongs to the requested vault and is active;
   - derive the `module_call_authority` PDA for deploy and recall.
3. Add `POST /transactions/modules/register`:
   - request: `vault`, `manager`, `moduleProgram`, `moduleState`, `moduleUnderlyingTokenAccount`, `policySeed`, optional `simulate`;
   - signer and fee payer: `manager`;
   - backend pre-checks that `manager == vault.manager`;
   - derive `module_entry` from vault, module program, and policy seed;
   - include `module_entry`, `module_program`, `module_state`, `module_underlying_token_account`, and `policySeed` in the summary.
4. Add `POST /transactions/modules/sync-nav`:
   - request: `vault`, `moduleEntry`, `feePayer`, optional `simulate`;
   - signer and fee payer: `feePayer`, used as the permissionless on-chain `cranker`;
   - fetch `ModuleEntry` and use its stored `module_state` and `module_program_id`;
   - do not accept `remainingAccounts` for the current on-chain instruction;
   - include old cached NAV, module state, module program, and module entry metadata in the summary when available from fetched state.
5. Add `POST /transactions/modules/deploy`:
   - request: `vault`, `manager`, `moduleEntry`, `amount`, `remainingAccounts`, optional `simulate`;
   - signer and fee payer: `manager`;
   - backend pre-checks that `manager == vault.manager`;
   - fetch `ModuleEntry` and use its stored `module_program_id` and `module_underlying_token_account`;
   - require `remainingAccounts` to include the stored module state and module underlying token account;
   - pass the remaining account metas in the exact supplied order after the vault instruction's fixed accounts;
   - include `module_underlying`, `module_entry`, `module_program`, `module_state`, `module_underlying_token_account`, and remaining-account count in the summary.
6. Add `POST /transactions/modules/recall`:
   - request: `vault`, `manager`, `moduleEntry`, `amount`, `remainingAccounts`, optional `simulate`;
   - signer and fee payer: `manager`;
   - backend pre-checks that `manager == vault.manager`;
   - fetch `ModuleEntry` and use its stored `module_program_id`;
   - require `remainingAccounts` to include the stored module state and the vault token account;
   - pass the remaining account metas in the exact supplied order after the vault instruction's fixed accounts;
   - include `module_underlying`, `module_entry`, `module_program`, `module_state`, `vault_token_account`, and remaining-account count in the summary.
7. Add configuration or fixture helpers for known module account lists:
   - the helper layer is a usability bridge between human-readable module fixture data and the generic `remainingAccounts` array required by `deploy` and `recall`;
   - keep the HTTP endpoints array-based. The backend route should still receive ordered `remainingAccounts`; helpers or scripts can produce that array from friendlier named fields;
   - start with the mock yield module because it is small and deterministic. For mock deploy, the generated `remainingAccounts` order is `mock_module_state` writable, then `module_token_account` writable. For mock recall, the order is `mock_module_state` writable, `mock_module_authority` readonly, `underlying_mint` readonly, `module_token_account` writable, `vault_token_account` writable, and `token_program` readonly;
   - add a Kamino USDC fixture for the known reserve after the generic endpoint shape is working. The fixture should mirror the Anchor account order in `kamino_yield_module` minus `module_call_authority`, which is prepended by the vault program;
   - store or derive these helper inputs from local fixture output for mock testing first, then from Surfpool/Kamino fixture data for real-account tests;
   - all generated accounts should keep `isSigner: false` until the backend response contract supports extra module-specific signers.
8. Add module manual inspect scripts incrementally after the module builder surface is stable:
   - start with `register_module`, because deploy, recall, and sync-nav need an existing on-chain `ModuleEntry`;
   - sign and send the saved register transaction with the existing transaction signing script;
   - add `sync_module_nav` next, because it is permissionless and does not require `remainingAccounts`;
   - add `deploy_to_module` after a successful deposit and module registration, consuming fixture-generated mock deploy `remainingAccounts`;
   - add `recall_from_module` after a successful deploy, consuming fixture-generated mock recall `remainingAccounts`;
   - manual inspect scripts should consume the fixture helpers instead of hardcoding long account arrays in each script;
   - Surfpool-backed Kamino tests should come after the Kamino fixture account list is stable, because those tests validate the real protocol account wiring rather than the generic backend response shape alone.

### Phase 6: Compute Budget Tuning

Add compute budget tuning after the shared transaction-building surface and
manual Kamino flow are stable.

1. Add shared API DTOs for `computeBudget`:
   - support `none`, `fixed`, and `auto` modes;
   - default to `none`;
   - parse `microLamports` as a string-backed u64-like value;
   - validate `unitLimit`, `marginBps`, and incompatible field combinations in
     one shared helper.
2. Add response metadata:
   - top-level optional `computeBudget`;
   - include final requested units, estimated units when available, margin, and
     compute unit price.
3. Add compute budget instruction helpers:
   - create `SetComputeUnitLimit`;
   - create `SetComputeUnitPrice`;
   - always prepend them before vault/business instructions.
4. Split simulation responsibilities:
   - keep user-facing diagnostic simulation controlled by `simulate`;
   - add internal estimation simulation for `computeBudget.mode = "auto"`;
   - make estimation failure a structured error.
5. Update the shared transaction response builder:
   - accept business instructions and compute budget options;
   - build a provisional transaction for estimation when needed;
   - rebuild the final unsigned transaction with compute budget instructions;
   - optionally simulate the final transaction for user-facing diagnostics.
6. Roll out endpoint wiring incrementally:
   - start with `deposit`;
   - then user withdraw builders;
   - then mock module deploy;
   - then Kamino deploy/recall on Surfpool.
7. Update manual inspect scripts only after the backend DTO is stable:
   - add `--compute-budget-mode`;
   - add `--compute-unit-limit` for fixed mode;
   - add `--compute-margin-bps` for auto mode;
   - add `--compute-unit-price-micro-lamports` for priority fee testing.

## 16. Decisions Before Implementation

Before writing the backend, decide these points:

1. Backend location: create it inside this repo as `backend/`, or create a separate repo.
2. Rust framework: use `axum` unless there is a reason to choose another framework.
3. Transaction format: return base64 serialized `VersionedTransaction`, or return raw instructions and let the client assemble the transaction.
4. Fee payer policy: user wallet as fee payer for normal user actions; explicit client-provided `feePayer` for permissionless/cranker transaction builders.
5. Submission policy: backend only builds transactions for now; backend submission for permissionless/cranker transactions can be added later as a separate configured mode.
6. Simulation policy: always simulate, make simulation optional, or skip simulation in the first version.
7. Cluster support: localnet only first, or localnet plus devnet from the beginning.
8. Kamino account source: static config/fixture first, or implement account discovery immediately.
9. API auth: public transaction builder, or role-aware API keys for manager/admin endpoints.
10. First endpoint: start with `deposit`, because it is the simplest user flow and gives quick feedback.
11. Compute budget default: keep `none` for backwards compatibility, then enable
    `auto` selectively after manual verification.
12. Priority fee source: accept caller-provided `microLamports` first; defer
    dynamic fee discovery to a production operations phase.
