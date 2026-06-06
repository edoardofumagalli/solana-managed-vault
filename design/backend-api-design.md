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

## 5. Who Signs And Who Sends

Signing rules should match the Anchor account constraints.

| Action | Required signer | Who sends the transaction |
| --- | --- | --- |
| `deposit` | User/depositor | Client wallet |
| `request_withdraw` | User | Client wallet |
| `cancel_withdraw` | User | Client wallet |
| `process_withdraw` | Transaction fee payer only | Client, backend, or cranker |
| `manager_deposit` | Caller returning funds | Client wallet or operational wallet |
| `request_manager_withdraw` | Manager | Manager wallet |
| `execute_manager_withdraw` | Permissionless executor signer; use fee payer by default | Manager, backend, or cranker |
| `report_float_value` | Manager | Manager wallet |
| `register_module` | Manager | Manager wallet |
| `deploy_to_module` | Manager | Manager wallet |
| `recall_from_module` | Manager | Manager wallet |
| `sync_module_nav` | Permissionless cranker signer; use fee payer by default | Client, backend, or cranker |
| `nominate_manager` | Current manager | Manager wallet |
| `accept_manager` | Pending manager | Pending manager wallet |
| `activate_emergency_shutdown` | Emergency admin | Emergency admin wallet |

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

### Endpoint Inputs

| Endpoint | Minimal request data | Backend derives or reads |
| --- | --- | --- |
| `POST /transactions/deposit` | `vault`, `user`, `amount` | Vault state, underlying mint, share mint, vault token account, user underlying ATA, user share ATA |
| `POST /transactions/request-withdraw` | `vault`, `user`, `sharesAmount` | Vault state, share mint, user share ATA, user position PDA, next ticket PDA, escrow share token account |
| `POST /transactions/cancel-withdraw` | `vault`, `user`, `ticketIndex` | Withdraw ticket PDA, escrow share token account, user share ATA |
| `POST /transactions/process-withdraw` | `vault`, `user`, `ticketIndex`, `feePayer` | Withdraw ticket PDA, user position PDA, escrow share token account, share mint, vault token account, user underlying ATA |
| `POST /transactions/manager-deposit` | `vault`, `caller`, `amount`, optional source token account | Vault state, vault token account, underlying mint, caller underlying ATA if source not provided |
| `POST /transactions/manager-withdraw/request` | `vault`, `manager`, `amount`, `receiverTokenAccount` | Manager withdraw request PDA, vault token account, vault state |
| `POST /transactions/manager-withdraw/execute` | `vault`, `requestId`, `feePayer` | Manager withdraw request PDA, vault token account, receiver token account from request; backend uses `feePayer` as executor |
| `POST /transactions/report-float-value` | `vault`, `manager`, `reportedFloatValue` | Vault state, vault token account |
| `POST /transactions/modules/register` | `vault`, `manager`, `moduleProgram`, `moduleState`, `moduleUnderlyingTokenAccount`, `policySeed` | Module entry PDA and vault state |
| `POST /transactions/modules/deploy` | `vault`, `manager`, `moduleEntry`, `amount`, module-specific accounts | Vault state, module entry, module call authority PDA, remaining accounts for module `deposit(amount)` |
| `POST /transactions/modules/recall` | `vault`, `manager`, `moduleEntry`, `amount`, module-specific accounts | Vault state, module entry, module call authority PDA, remaining accounts for module `withdraw(amount)` |
| `POST /transactions/modules/sync-nav` | `vault`, `moduleEntry`, `feePayer`, module-specific accounts | Vault state, module entry, module-specific NAV accounts; backend uses `feePayer` as cranker |
| `POST /transactions/emergency-shutdown` | `vault`, `emergencyAdmin` | Vault state |

For Kamino-specific module endpoints, the backend may also need reserve, market, oracle, collateral mint, liquidity supply, and token accounts. In the first version these can be read from configuration or fixtures before a full discovery layer exists.

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

## 12. Error Model

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
- `RPC_ERROR`

## 13. Security Notes

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

## 14. Implementation Plan

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

### Phase 2.5: Shared Transaction Utilities

Before adding more endpoint families, extract the repeated transaction-building pieces introduced by the deposit endpoint:

1. Move unsigned `VersionedTransaction` wrapping, placeholder signatures, base64 serialization, and required-signer metadata into a shared transaction builder helper.
2. Move optional simulation into a shared service so all endpoints return simulation summaries consistently.
3. Keep endpoint-specific builders focused on account resolution and Anchor instruction construction.
4. Preserve the user-wallet fee-payer model for normal user actions.
5. Use an explicit `feePayer` input for permissionless/cranker actions such as `process_withdraw`, because Solana transactions still require a fee payer signer even when the on-chain instruction has no user signer.

### Phase 3: User Withdraw Builders

1. Add `request_withdraw`.
2. Add `cancel_withdraw`.
3. Add `process_withdraw`.
4. Reuse the shared simulation service from Phase 2.5 for each withdraw endpoint.

### Phase 4: Manager Builders

1. Add manager role pre-checks.
2. Add manager float endpoints.
3. Add manager withdraw timelock endpoints.
4. Add emergency shutdown endpoint.

### Phase 5: Module Builders

1. Add module entry resolver.
2. Add generic deploy/recall builders.
3. Add Kamino account configuration for the known reserve.
4. Add Surfpool-backed integration tests.

## 15. Decisions Before Implementation

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
