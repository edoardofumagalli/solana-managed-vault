# Indexer And Read Side Plan

## Purpose

This document starts the read-side phase for the managed vault backend.

The current backend is primarily an action API: it builds unsigned Solana
transactions for clients to sign. A real application also needs read-side data:
vault overview, user balances and positions, pending tickets, module NAV,
manager activity, and historical timelines.

The agreed direction is event-first indexing.

The goal of this phase is to define which application read models should be
built from Anchor events, which event fields are sufficient or missing, and
where RPC still belongs as a support mechanism for bootstrap, reconciliation,
debugging, and external live balances.

This is an operational planning document. It does not change the Anchor program
or backend implementation by itself.

## Read-Side Mental Model

There are two complementary ways to obtain read data, but they do not have the
same role.

Event indexing is the primary source for application history and derived read
models:

- deposits and share mint history;
- withdraw requests, cancellations, and processing;
- manager float changes;
- manager withdraw lifecycle;
- module registration, NAV syncs, deploys, and recalls;
- emergency shutdown and manager changes;
- materialized vault, user, ticket, module, and manager views.

RPC reads remain useful, but not as the main application read layer:

- bootstrap the indexer from known accounts;
- reconcile indexed state against current on-chain accounts;
- read external state not fully controlled by the vault program, such as SPL
  token balances and mint supply;
- debug local and Surfpool flows;
- recover from missed events or suspected indexer drift.

The practical target is:

```text
Anchor events
    -> indexer
    -> database / materialized read models
    -> backend read API
```

RPC is still part of the system, but as a verification and external-data source:

```text
RPC accounts
    -> bootstrap / reconciliation / live balances
    -> compare with indexed read models
```

This avoids rebuilding complex UI state from live RPC calls on every request and
keeps historical state available even after Solana accounts are closed.

## First Read Models

### Vault Overview

Purpose: show current vault state and high-level accounting.

Primary source:

- indexed `VaultInitializedEvent`;
- indexed accounting events such as deposit, withdraw process, manager deposit,
  float report, module NAV sync, module deploy, and module recall;
- indexed manager/admin events for shutdown and manager changes.

RPC support:

- reconcile against current `Vault`;
- verify vault underlying token account balance;
- verify share mint supply;
- recover if the indexer needs a current-state checkpoint.

Useful fields:

- vault;
- manager;
- pending manager;
- emergency admin;
- underlying mint;
- share mint;
- vault token account;
- liquid underlying balance;
- share supply;
- float outstanding;
- modules NAV total;
- total assets;
- module count;
- max float bps;
- manager withdraw delay slots;
- shutdown status and shutdown slot;
- ticket counters.

### User Position

Purpose: show a user's current claim and pending withdraw state.

Primary source:

- indexed deposit and withdraw events;
- indexed ticket lifecycle events;
- materialized user read model.

RPC support:

- verify current user share token balance;
- verify current underlying token balance;
- reconcile `UserVaultPosition.pending_ticket_count`.

Useful fields:

- vault;
- user;
- share token account;
- share balance;
- underlying token account;
- underlying balance;
- pending ticket count;
- open tickets;
- deposit history;
- withdraw request/cancel/process history.

### Withdraw Tickets

Purpose: show the FIFO queue and user ticket lifecycle.

Primary source:

- indexed `WithdrawRequestedEvent`, `WithdrawCancelledEvent`, and
  `WithdrawProcessedEvent`.

RPC support:

- reconcile currently open `WithdrawTicket` accounts;
- recover if the indexer needs to rebuild open-ticket state from chain accounts.

Useful fields:

- vault;
- user;
- ticket account;
- ticket index;
- escrow share token account;
- shares;
- requested slot;
- status: open, cancelled, processed;
- processed or cancelled slot/signature if indexed.

### Module State

Purpose: show registered modules, cached NAV, and movement of capital.

Primary source:

- indexed `ModuleRegisteredEvent`;
- indexed `ModuleNavSyncedEvent`;
- indexed `ModuleCapitalDeployedEvent`;
- indexed `ModuleCapitalRecalledFromModuleEvent`;
- optional module-specific events for diagnostics.

RPC support:

- reconcile current `ModuleEntry` accounts;
- verify module token balances or protocol-specific external accounts when
  needed.

Useful fields:

- vault;
- module entry;
- module program id;
- policy seed;
- module state;
- module underlying token account;
- cached NAV;
- NAV last updated slot;
- active flag;
- deploy/recall history.

### Manager Activity

Purpose: show float accounting, manager withdrawals, manager changes, and
shutdown actions.

Primary source:

- indexed manager/admin events;
- indexed manager withdraw request and execution events;
- materialized manager activity read model.

RPC support:

- reconcile current `Vault.manager`, `Vault.pending_manager`, and shutdown
  fields;
- reconcile open `ManagerWithdrawRequest` accounts.

Useful fields:

- current manager;
- pending manager;
- emergency admin;
- float outstanding;
- float report history;
- manager deposit history;
- manager withdraw requests and executions;
- manager nomination/acceptance history;
- emergency shutdown history.

## Existing Event Delivery

The core vault, mock module, and Kamino module currently use Anchor `emit!`.
Those events are emitted into program logs as `Program data: ...`.

This is good for local testing and simple consumers. It is less robust for a
production-grade indexer because RPC providers can truncate logs. Anchor also
supports `emit_cpi!`, which emits event data through a self-CPI inner
instruction. That path costs more compute and requires Anchor event-CPI wiring,
but is generally more reliable for replay-oriented indexers.

Working decision for now:

- keep the current `emit!` events while designing the read side;
- start indexing from logs in local/dev flows;
- consider `emit_cpi!` only for business-critical events once the read models
  are clear.

## Core Vault Event Audit

| Event                                  | Emitted By                    | Main Fields                                                                                                                                                                         | Supports                                       | Status                                                                                            |
| -------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `VaultInitializedEvent`                | `initialize_vault`            | vault, manager, emergency admin, underlying mint, share mint, vault token account, max float bps, manager withdraw delay slots                                                      | vault discovery, initial config                | Sufficient for initial vault registry.                                                            |
| `EmergencyShutdownActivatedEvent`      | `activate_emergency_shutdown` | vault, emergency admin, shutdown slot, float outstanding                                                                                                                            | shutdown history, alerting                     | Mostly sufficient. Could add `modules_nav_total` later for full shutdown snapshot.                |
| `DepositEvent`                         | `deposit`                     | vault, depositor, assets in, shares out, total assets after, total shares after, float outstanding                                                                                  | user deposit history, share price history      | Good. Could add vault liquid balance and modules NAV total later for richer accounting snapshots. |
| `WithdrawRequestedEvent`               | `request_withdraw`            | vault, user, ticket, escrow share token account, ticket index, shares, requested slot, pending ticket count                                                                         | open ticket creation, user history, FIFO queue | Good. Asset value is intentionally not fixed at request time.                                     |
| `WithdrawCancelledEvent`               | `cancel_withdraw`             | vault, user, ticket, escrow, ticket index, shares returned, next ticket to process, pending ticket count                                                                            | ticket terminal status, user history           | Good. Could add slot for easier event-only timelines.                                             |
| `WithdrawProcessedEvent`               | `process_withdraw`            | vault, user, ticket, escrow, ticket index, shares burned, assets out, totals after, next ticket to process, pending ticket count                                                    | ticket terminal status, payouts, user history  | Good. Could add vault liquid balance after for dashboards.                                        |
| `ManagerWithdrawRequestedEvent`        | `request_manager_withdraw`    | vault, manager, request account, request id, receiver token account, amount, requested slot, executable after slot                                                                  | pending manager withdrawal list, timelock UX   | Good.                                                                                             |
| `ManagerWithdrawExecutedEvent`         | `execute_manager_withdraw`    | vault, manager, executor, request account, request id, receiver token account, amount, float outstanding, total assets                                                              | manager withdrawal history, float tracking     | Good. Could add vault liquid balance after.                                                       |
| `FloatValueReportedEvent`              | `report_float_value`          | vault, manager, old float value, new float value, vault underlying balance, total assets                                                                                            | NAV/float history, share price history         | Good. Could add modules NAV total for full accounting snapshot.                                   |
| `ManagerDepositEvent`                  | `manager_deposit`             | vault, caller, assets in, returned float, excess amount, float outstanding, total assets                                                                                            | manager return history, float tracking         | Good. Could add source token account if useful for audit.                                         |
| `ManagerNominatedEvent`                | `nominate_manager`            | vault, current manager, pending manager                                                                                                                                             | manager change history                         | Sufficient.                                                                                       |
| `ManagerAcceptedEvent`                 | `accept_manager`              | vault, old manager, new manager                                                                                                                                                     | manager change history                         | Sufficient.                                                                                       |
| `ModuleRegisteredEvent`                | `register_module`             | vault, manager, module entry, module program id, module state, module underlying token account, policy seed, module count                                                           | module registry, module discovery              | Good. Could include initial cached NAV if non-zero modules are ever supported.                    |
| `ModuleNavSyncedEvent`                 | `sync_module_nav`             | vault, cranker, module entry, module program id, module state, old cached NAV, new cached NAV, modules NAV total, slot                                                              | module NAV history, crank history              | Good.                                                                                             |
| `ModuleCapitalDeployedEvent`           | `deploy_to_module`            | vault, manager, module entry, module program id, module state, vault token account, module token account, amount, deployed value after, old/new cached NAV, modules NAV total, slot | deploy history, module accounting              | Good. Could add liquid vault balance after for overview snapshots.                                |
| `ModuleCapitalRecalledFromModuleEvent` | `recall_from_module`          | vault, manager, module entry, module program id, module state, vault token account, requested amount, returned amount, old/new cached NAV, modules NAV total, slot                  | recall history, module accounting              | Good. Could add module token account for symmetry with deploy.                                    |

## Operational Event Audit

Every decoded event should first be stored in a raw event table or JSON stream.
Materialized read models are then updated from that normalized event stream.

There are three separate data shapes in this phase:

1. Parser run output.
   - File/debug envelope produced by the local parser script.
   - Useful for manual testing and parser diagnostics.
   - Contains run-level fields such as `schema`,
     `createdAt`, `rpcUrl`, `commitment`, `catalog`, and
     `expectedEventCheck`.
   - Its `events` array contains normalized raw events.
2. Normalized raw event.
   - The durable event record that should later be stored in a database or
     event stream.
   - This is the source record for idempotent ingestion and replay.
   - Schema: `managed-vault.rawEvent.v1`.
3. Materialized read model.
   - Derived state built from raw events.
   - Examples: `vault_event_timeline`, `tickets`, `modules`, `vaults`,
     `user_positions`, and `manager_activity`.
   - These records are query-optimized and can be rebuilt from raw events.

The parser run output currently uses:

```json
{
  "schema": "managed-vault.indexerEvents.v1",
  "createdAt": "2026-07-15T00:00:00.000Z",
  "parserVersion": "managed-vault-event-parser-v1",
  "cluster": "localnet",
  "rpcUrl": "http://127.0.0.1:8899",
  "commitment": "confirmed",
  "signature": "<transaction signature>",
  "slot": 123,
  "blockTime": 1234567890,
  "programId": "<program id>",
  "transactionError": null,
  "logCount": 11,
  "eventCount": 1,
  "catalog": {},
  "expectedEventCheck": {},
  "events": []
}
```

The normalized raw event shape should be:

```json
{
  "schema": "managed-vault.rawEvent.v1",
  "eventId": "localnet:<signature>:<programId>:0",
  "cluster": "localnet",
  "source": {
    "kind": "rpc_getTransaction_logs",
    "commitment": "confirmed",
    "eventSource": "anchor_emit_log"
  },
  "transaction": {
    "signature": "<transaction signature>",
    "error": null
  },
  "block": {
    "slot": 123,
    "blockTime": 1234567890
  },
  "order": {
    "eventIndex": 0,
    "programEventIndex": 0,
    "logIndex": null,
    "instructionIndex": null,
    "innerInstructionIndex": null
  },
  "program": {
    "id": "<program id>",
    "name": "anchor_managed_vault"
  },
  "event": {
    "name": "DepositEvent",
    "coreEvent": true,
    "instruction": "deposit",
    "category": "user",
    "readModels": ["vaults", "user_positions", "vault_event_timeline"],
    "data": {}
  },
  "entities": {
    "vault": "<vault public key>",
    "user": "<user public key>",
    "manager": null,
    "ticket": null,
    "moduleEntry": null,
    "moduleState": null,
    "moduleProgram": null,
    "managerWithdrawRequest": null
  },
  "ingest": {
    "parsedAt": "2026-07-15T00:00:00.000Z",
    "parserVersion": "managed-vault-event-parser-v1"
  }
}
```

`eventId` is the first idempotency key. The initial format is:

```text
cluster:signature:programId:eventIndex
```

This is enough for the current core-vault-first parser. If later we index
multiple programs or adopt `emit_cpi!`, the ordering metadata can be made more
precise without changing the basic raw event contract.

Ordering fields:

- `eventIndex`: sequential index of decoded events in this parser run for the
  target program. This is populated now.
- `programEventIndex`: sequential index of events emitted by the same program
  in the transaction. For the first core vault parser, it matches `eventIndex`.
- `logIndex`: index of the original `meta.logMessages` row that carried the
  event. This is useful for audit/debug and should be populated in a later
  parser pass.
- `instructionIndex`: top-level Solana instruction index that emitted the log.
  This matters when a transaction contains several instructions.
- `innerInstructionIndex`: CPI/inner-instruction index. This is mostly reserved
  for later `emit_cpi!` or deeper CPI-aware parsing.

For the current parser, `eventIndex` and `programEventIndex` are populated;
`logIndex`, `instructionIndex`, and `innerInstructionIndex` are intentionally
`null`.

`entities` intentionally duplicates selected fields from `event.data`. This is
not the canonical business payload; it is an indexing convenience for common
queries such as "all events for this vault", "all events for this ticket", or
"all events for this module entry".

### Future `raw_events` Table

Cadence uses append-only event tables with replay-safe writes. For the managed
vault, the first persisted event store should be slightly more generic because
we have many event types and are still iterating on read models.

Working decision: skip an additional intermediate mapper format and make
Postgres the first durable target after the local parser. The local parser still
prints JSON for manual inspection, but the durable shape is the normalized
`managed-vault.rawEvent.v1` record stored in Postgres.

The recommended first table is one append-only `raw_events` table. It stores
the full `managed-vault.rawEvent.v1` record as the canonical payload, plus
extracted columns for idempotency, ordering, and common queries.

The initial migration is:

```text
backend/migrations/20260715000001_create_raw_events.sql
```

This migration intentionally creates only the raw event store. Materialized read
model tables should be added after we have inserted and replayed real raw
events locally.

### Local Postgres With Docker Compose

For local development, Postgres is run through Docker Compose from the repository
root:

```bash
docker compose up -d postgres
```

The local development database uses:

```text
host: 127.0.0.1
port: 5432
database: managed_vault_dev
user: managed_vault
password: managed_vault
```

The corresponding connection string is:

```text
postgres://managed_vault:managed_vault@127.0.0.1:5432/managed_vault_dev
```

The backend reads this value from `DATABASE_URL`. If `DATABASE_URL` is not set,
the Rust backend defaults to the local Docker Compose connection string above.

The compose service mounts `backend/migrations` into the container at
`/migrations`, so the first migration can be applied without installing `psql`
on the host:

```bash
docker compose exec postgres \
  psql -U managed_vault -d managed_vault_dev \
  -f /migrations/20260715000001_create_raw_events.sql
```

To inspect the schema:

```bash
docker compose exec postgres \
  psql -U managed_vault -d managed_vault_dev \
  -c '\d+ raw_events'
```

Draft Postgres shape:

```sql
CREATE TABLE raw_events (
    event_id                    TEXT PRIMARY KEY,
    schema                      TEXT NOT NULL,

    cluster                     TEXT NOT NULL,

    source_kind                 TEXT NOT NULL,
    source_commitment           TEXT,
    source_event_source         TEXT NOT NULL,

    signature                   TEXT NOT NULL,
    transaction_error           JSONB,

    slot                        BIGINT NOT NULL,
    block_time_unix             BIGINT,

    order_event_index           INT NOT NULL,
    order_program_event_index   INT,
    order_log_index             INT,
    order_instruction_index     INT,
    order_inner_instruction_index INT,

    program_id                  TEXT NOT NULL,
    program_name                TEXT,

    event_name                  TEXT NOT NULL,
    instruction                 TEXT,
    category                    TEXT,
    core_event                  BOOLEAN NOT NULL DEFAULT TRUE,
    read_models                 TEXT[] NOT NULL DEFAULT '{}',

    vault                       TEXT,
    user_pubkey                 TEXT,
    manager_pubkey              TEXT,
    ticket                      TEXT,
    module_entry                TEXT,
    module_state                TEXT,
    module_program              TEXT,
    manager_withdraw_request    TEXT,

    event_data                  JSONB NOT NULL,
    raw_event                   JSONB NOT NULL,

    parser_version              TEXT,
    parsed_at                   TIMESTAMPTZ,
    ingested_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Recommended first indexes:

```sql
CREATE INDEX idx_raw_events_signature
    ON raw_events (signature);

CREATE INDEX idx_raw_events_order
    ON raw_events (
        slot,
        order_instruction_index,
        order_inner_instruction_index,
        order_log_index,
        order_event_index,
        event_id
    );

CREATE INDEX idx_raw_events_program_event
    ON raw_events (program_id, event_name, slot);

CREATE INDEX idx_raw_events_vault
    ON raw_events (vault, slot, order_event_index)
    WHERE vault IS NOT NULL;

CREATE INDEX idx_raw_events_user
    ON raw_events (user_pubkey, slot)
    WHERE user_pubkey IS NOT NULL;

CREATE INDEX idx_raw_events_ticket
    ON raw_events (ticket)
    WHERE ticket IS NOT NULL;

CREATE INDEX idx_raw_events_module_entry
    ON raw_events (module_entry, slot)
    WHERE module_entry IS NOT NULL;

CREATE INDEX idx_raw_events_manager
    ON raw_events (manager_pubkey, slot)
    WHERE manager_pubkey IS NOT NULL;
```

Notes:

- `event_id` is the replay/idempotency key. Ingestion should use
  `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
- `raw_event` preserves the complete normalized event and remains the canonical
  stored source. `event_data` duplicates `raw_event.event.data` for easier
  inspection and JSON queries.
- The extracted entity columns intentionally duplicate data from `raw_event`.
  They are query indexes, not independent truth.
- Public keys are stored as base58 `TEXT` in this first design because the
  parser and manual tooling already use base58 JSON. Cadence stores pubkeys as
  `BYTEA(32)`, which is more compact and stricter; we can adopt that later if
  the first DB implementation is fully Rust/Postgres-first.
- `block_time_unix` mirrors Solana `blockTime` as returned by RPC. A future
  migration may also store a derived `TIMESTAMPTZ` if SQL date filtering becomes
  important.
- Ordering columns allow the table to support today's `emit!` log parser and a
  later `emit_cpi!`/inner-instruction parser without changing the table shape.
- This table is not a materialized read model. It is the append-only source used
  to rebuild materialized tables such as `vault_event_timeline`, `tickets`,
  `modules`, `vaults`, `user_positions`, and `manager_activity`.

The operational audit below answers the implementation questions for the first
indexer:

- should the event be parsed in the first parser;
- which materialized read models it updates;
- which state mutation the indexer applies;
- whether the current event is enough to proceed;
- whether it is a future `emit_cpi!` candidate.

| Event                                  | Index Now | Materialized Models Updated                                                                               | State Mutation                                                                                                                    | Sufficiency For First Indexer                                                                                       | Future `emit_cpi!`                                                                  |
| -------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `VaultInitializedEvent`                | Yes       | `vaults`, `vault_event_timeline`                                                                          | Insert vault registry row with manager, emergency admin, mints, token account, float config, and manager withdrawal delay.        | Enough. Initial counters such as ticket indexes start from known defaults.                                          | Medium. Important for discovery, but emitted once per vault.                        |
| `EmergencyShutdownActivatedEvent`      | Yes       | `vaults`, `vault_event_timeline`, `manager_activity`                                                      | Mark vault shutdown, set shutdown slot, append shutdown timeline entry.                                                           | Enough for status. Add `modules_nav_total` later only for richer snapshot views.                                    | High. Shutdown is operationally important.                                          |
| `DepositEvent`                         | Yes       | `vaults`, `user_positions`, `user_activity`, `vault_event_timeline`, `share_price_checkpoints`            | Append deposit, increase user lifetime deposits/shares minted, update vault total assets/share supply snapshot from event fields. | Enough for history and derived snapshots. Reconcile live token balances separately.                                 | High. User-facing accounting event.                                                 |
| `WithdrawRequestedEvent`               | Yes       | `tickets`, `user_positions`, `user_activity`, `vault_event_timeline`                                      | Insert open ticket, set user pending ticket count, append request timeline entry.                                                 | Enough. Asset amount is intentionally not fixed at request time.                                                    | High. Creates state that may disappear from RPC after closure.                      |
| `WithdrawCancelledEvent`               | Yes       | `tickets`, `user_positions`, `user_activity`, `vault_event_timeline`                                      | Mark ticket cancelled, set returned shares, update next ticket pointer and user pending count.                                    | Enough. Use transaction slot as terminal slot if no explicit event slot exists.                                     | High. Terminal ticket event.                                                        |
| `WithdrawProcessedEvent`               | Yes       | `tickets`, `user_positions`, `user_activity`, `vaults`, `vault_event_timeline`, `share_price_checkpoints` | Mark ticket processed, record shares burned/assets out, update vault total assets/share supply snapshot and user pending count.   | Enough. Add liquid vault balance later if dashboard needs exact post-transfer liquidity without RPC reconciliation. | High. Terminal payout event.                                                        |
| `ManagerWithdrawRequestedEvent`        | Yes       | `manager_withdraw_requests`, `manager_activity`, `vault_event_timeline`                                   | Insert pending manager withdrawal request with executable slot and receiver token account.                                        | Enough.                                                                                                             | High. Creates timelocked manager action.                                            |
| `ManagerWithdrawExecutedEvent`         | Yes       | `manager_withdraw_requests`, `manager_activity`, `vaults`, `vault_event_timeline`                         | Mark manager request executed, record executor, update float outstanding and total assets snapshot.                               | Enough. Add liquid vault balance later if needed.                                                                   | High. Changes off-vault float.                                                      |
| `FloatValueReportedEvent`              | Yes       | `vaults`, `manager_activity`, `vault_event_timeline`, `share_price_checkpoints`                           | Record float NAV report, update float outstanding and total assets snapshot.                                                      | Enough. Add `modules_nav_total` later for full component breakdown.                                                 | High. Reprices vault shares.                                                        |
| `ManagerDepositEvent`                  | Yes       | `vaults`, `manager_activity`, `vault_event_timeline`                                                      | Record returned float/excess amount, update float outstanding and total assets snapshot.                                          | Enough. Add source token account later only for deeper audit.                                                       | Medium. Important, but less likely to need immediate CPI hardening than user exits. |
| `ManagerNominatedEvent`                | Yes       | `vaults`, `manager_activity`, `vault_event_timeline`                                                      | Set pending manager and append governance/admin timeline entry.                                                                   | Enough.                                                                                                             | Low.                                                                                |
| `ManagerAcceptedEvent`                 | Yes       | `vaults`, `manager_activity`, `vault_event_timeline`                                                      | Set current manager, clear or replace pending manager in materialized state, append acceptance entry.                             | Enough.                                                                                                             | Low.                                                                                |
| `ModuleRegisteredEvent`                | Yes       | `modules`, `vaults`, `module_activity`, `vault_event_timeline`                                            | Insert module entry with program, module state, token account, policy seed, and update vault module count.                        | Enough. Add initial cached NAV only if non-zero initial NAV is introduced.                                          | Medium-high. Required for module discovery.                                         |
| `ModuleNavSyncedEvent`                 | Yes       | `modules`, `vaults`, `module_activity`, `vault_event_timeline`, `share_price_checkpoints`                 | Update module cached NAV, module last update slot, and vault modules NAV total.                                                   | Enough.                                                                                                             | Medium-high. Important for accounting history.                                      |
| `ModuleCapitalDeployedEvent`           | Yes       | `modules`, `vaults`, `module_activity`, `vault_event_timeline`, `share_price_checkpoints`                 | Append deploy, update module cached NAV, module deployed value, and vault modules NAV total.                                      | Enough. Add liquid vault balance later for richer snapshots.                                                        | High. Heavy strategy accounting event.                                              |
| `ModuleCapitalRecalledFromModuleEvent` | Yes       | `modules`, `vaults`, `module_activity`, `vault_event_timeline`, `share_price_checkpoints`                 | Append recall, record requested/returned amount, update module cached NAV and vault modules NAV total.                            | Enough. Add module token account later for symmetry/debugging.                                                      | High. Heavy strategy accounting event.                                              |

Operational priority for the first Postgres-backed indexer slice:

1. Apply the `raw_events` migration locally.
2. Insert normalized `managed-vault.rawEvent.v1` records into `raw_events`
   with `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
3. Verify replay/idempotency by ingesting the same parsed transaction twice.
4. Build `vault_event_timeline` from persisted `raw_events`.
5. Add `tickets` materialization from request/cancel/process events.
6. Add `modules` materialization from register/sync/deploy/recall events.
7. Add `vaults` snapshots from accounting events.
8. Add `user_positions` and `manager_activity`.

This order keeps the first prototype small while avoiding a throwaway
intermediate format. The first proof is not only "can we parse an event", but
"can we persist and replay the canonical raw event stream".

## Module Event Audit

### Mock Yield Module

Mock module events are useful for local harness validation, but the canonical
vault accounting events should come from the core vault program.

| Event                          | Emitted By         | Main Fields                                                                              | Supports                   | Status                        |
| ------------------------------ | ------------------ | ---------------------------------------------------------------------------------------- | -------------------------- | ----------------------------- |
| `MockModuleInitializedEvent`   | mock initialize    | vault, module state, module token account, underlying mint                               | fixture/debugging          | Sufficient for local testing. |
| `MockModuleNavCalculatedEvent` | mock calculate NAV | vault, module state, cached NAV, slot                                                    | module debug history       | Sufficient for local testing. |
| `MockModuleDepositedEvent`     | mock deposit       | vault, module state, module token account, amount, cached NAV, slot                      | module-level debug history | Sufficient for local testing. |
| `MockModuleWithdrawnEvent`     | mock withdraw      | vault, module state, vault token account, module token account, amount, cached NAV, slot | module-level debug history | Sufficient for local testing. |

### Kamino Yield Module

Kamino module events add protocol-specific details that the generic core vault
does not know.

| Event                        | Emitted By             | Main Fields                                                                                                                                         | Supports                           | Status                                                                     |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `KaminoModuleDepositedEvent` | Kamino module deposit  | vault, module state, reserve, module underlying token account, vault collateral account, amount, cached NAV, slot                                   | Kamino-specific deploy diagnostics | Good. Could add collateral amount minted if needed for protocol analytics. |
| `KaminoModuleWithdrawnEvent` | Kamino module withdraw | vault, module state, reserve, vault collateral account, vault token account, requested amount, collateral amount, returned amount, cached NAV, slot | Kamino-specific recall diagnostics | Good.                                                                      |

## Event Gaps And Improvement Candidates

The current event set is strong enough to start a first read-side design. The
main gaps are not blockers; they are enrichment candidates.

Candidate event field additions:

- Add `modules_nav_total` to `DepositEvent`, `FloatValueReportedEvent`, and
  `EmergencyShutdownActivatedEvent` when a full accounting snapshot is useful.
- Add vault liquid balance after state-changing events that move underlying:
  deposit, process withdraw, manager withdraw execute, manager deposit,
  module deploy, and module recall.
- Add `slot` consistently to all terminal/history events. Some events already
  include an explicit slot; others rely on transaction metadata.
- Add `module_token_account` to `ModuleCapitalRecalledFromModuleEvent` for
  symmetry with deploy.
- Add source token account to `ManagerDepositEvent` if tracing the payer token
  account matters.
- Add collateral amount to `KaminoModuleDepositedEvent` if Kamino position
  analytics become a first-class read requirement.

Candidate missing event types:

- No explicit "module deactivated" event exists because the current core does
  not expose a deactivate instruction.
- No explicit "ticket skipped" event exists because FIFO currently either
  processes/cancels the current ticket or fails.
- No explicit "share price checkpoint" event exists. Share price can be derived
  from state snapshots in deposit/process/float/module events, but a dedicated
  checkpoint event may be useful later.

Candidate `emit_cpi!` priorities:

1. `DepositEvent`
2. `WithdrawRequestedEvent`
3. `WithdrawCancelledEvent`
4. `WithdrawProcessedEvent`
5. `ManagerWithdrawRequestedEvent`
6. `ManagerWithdrawExecutedEvent`
7. `FloatValueReportedEvent`
8. `ManagerDepositEvent`
9. `ModuleRegisteredEvent`
10. `ModuleNavSyncedEvent`
11. `ModuleCapitalDeployedEvent`
12. `ModuleCapitalRecalledFromModuleEvent`
13. `EmergencyShutdownActivatedEvent`
14. manager nomination and acceptance events

The practical recommendation is not to migrate everything to `emit_cpi!`
immediately. First build the read models and local parser against existing
events. Then migrate only the events whose loss would break important history or
user-facing state.

## Initial Read API Direction

The first read API should be backed by indexed/materialized data, not by
scanning RPC on every request.

Do not start with `GET /vaults/:vault` as an RPC-only implementation unless it
is explicitly marked as a temporary diagnostic endpoint. The durable direction
is to build the event ingestion layer first, then serve read endpoints from the
materialized read models.

Suggested read API order after the first event parser exists:

1. `GET /vaults/:vault/events`
   - serve the normalized vault event timeline;
   - useful for validating ingestion before building complex read models.
2. `GET /vaults/:vault`
   - serve the materialized vault overview;
   - optionally attach reconciliation metadata from the latest RPC check.
3. `GET /vaults/:vault/modules`
   - serve materialized module registry and NAV state;
   - optionally enrich with protocol-specific external data.
4. `GET /vaults/:vault/users/:user`
   - serve materialized user history and derived position;
   - optionally enrich with live token balances from RPC.
5. `GET /vaults/:vault/users/:user/tickets`
   - serve ticket lifecycle from indexed events;
   - optionally reconcile open tickets from RPC.
6. `GET /vaults/:vault/manager-withdraw-requests`
   - serve pending and historical manager withdrawal lifecycle.

The read endpoint contracts can be drafted early, but implementation should
follow event ingestion so the API shape reflects real indexed data.

## Initial Indexer Strategy

Phase 1: local event parser.

- Given one confirmed transaction signature, fetch the transaction.
- Parse transaction logs for the core vault program.
- Decode Anchor `emit!` events using the IDL/event discriminators.
- Normalize parsed events into `managed-vault.rawEvent.v1` records:
  - idempotent `eventId`;
  - cluster;
  - source information;
  - transaction signature and transaction error;
  - slot and block time;
  - ordering metadata;
  - program metadata;
  - event metadata and event data;
  - extracted query entities;
  - ingest metadata.
- Store parsed events in JSON or print them to stdout for manual validation.
- Use localnet and Surfpool transactions already produced by the backend manual
  testing flow.

Definition of done:

- We can point a script at a known deposit/deploy/recall signature and see the
  decoded managed vault events.
- The normalized JSON contains `managed-vault.rawEvent.v1` records that can
  become the input format for a later database indexer.

Current status:

- `anchor_managed_vault/scripts/parse_vault_events.js` implements this phase for
  one transaction signature at a time.
- The script output is a parser run envelope with schema
  `managed-vault.indexerEvents.v1`.
- Each item in `events[]` is already a normalized raw event with schema
  `managed-vault.rawEvent.v1`.
- The parser is intentionally read-only: it fetches a transaction, decodes logs,
  validates optional expected events, and writes JSON for inspection. It does
  not persist events to a database and does not build materialized read models.
- `anchor_managed_vault/scripts/build_vault_event_timeline.js` is the first
  local transformer. It consumes parser outputs or raw event arrays, filters
  events that target `vault_event_timeline`, sorts them by chain/order
  metadata, and writes a local materialized timeline with schema
  `managed-vault.vaultEventTimeline.v1`.

Phase 2: database-backed indexer.

- Store events keyed by `eventId`, with additional indexes on signature, slot,
  program id, event name, vault, user, ticket, and module entry.
- Make ingestion idempotent.
- Maintain materialized read models:
  - vaults;
  - users;
  - tickets;
  - modules;
  - manager withdraw requests;
  - event timeline.

Current status:

- Postgres runs locally through Docker Compose.
- The backend creates a shared Postgres pool from `DATABASE_URL`.
- `backend/src/repositories/raw_events.rs` contains the first repository for
  idempotent `raw_events` inserts and row counting.
- `backend/src/bin/index_transaction.rs` is the first manual Rust consumer:
  given one transaction signature, it fetches the transaction from RPC, decodes
  core vault `emit!` logs, inserts normalized `raw_events` rows, and reports
  inserted versus duplicate events.
- The Rust decoder filters `Program data:` logs to the configured vault program
  execution context before matching Anchor event discriminators. This keeps the
  first consumer focused on core vault events even when the transaction also
  contains CPI logs from external programs.

Example local usage:

```bash
cd backend
NO_DNA=1 cargo run --bin index_transaction -- \
  --signature <transaction_signature>
```

Run the same command twice with the same signature to verify idempotency. The
first run should report inserted rows; the second should report duplicate skips.

Phase 3: production-grade event delivery.

- Decide whether to use logs, a Geyser/WebSocket provider, fetched transaction
  history, `emit_cpi!`, or a hybrid approach.
- Add reconciliation jobs that compare indexed state with live RPC state.
- Consider `emit_cpi!` for business-critical events after measuring compute
  impact.

Phase 4: read API over materialized state.

- Serve read endpoints from the database/materialized read models.
- Include reconciliation status where useful.
- Keep action transaction-building endpoints separate from read endpoints.

## Open Decisions

- Should the first read API live in the same Axum backend or a separate service?
  Recommendation: same backend first, separate later only if indexing workload
  justifies it.
- Should the first read endpoints scan RPC accounts on demand?
  Recommendation: no as the main path. Allow temporary diagnostic endpoints or
  reconciliation helpers, but keep the durable read API event-indexed.
- Should token balances come from RPC or the indexer?
  Recommendation: use RPC as an enrichment/reconciliation source, because SPL
  token transfers can happen outside the vault program.
- Should history be event-first?
  Recommendation: yes. History and materialized business state should come from
  indexed program events.
- Should `emit_cpi!` be adopted now?
  Recommendation: not yet. Document candidates, then decide after the first
  parser/read models expose real requirements.
- Should the indexer ingest only the core vault program or also module programs?
  Recommendation: core vault first. Add module program events when we need
  protocol-specific diagnostics, especially for Kamino.

## Next Implementation Steps

1. Keep validating the local parser and timeline transformer against known
   manual-test signatures:
   - deposit;
   - request/cancel/process withdraw;
   - module register/sync/deploy/recall;
   - Kamino deploy/recall when available.
2. Treat `events[]` from the parser output as the canonical
   `managed-vault.rawEvent.v1` input for the next local prototype.
3. Use `backend:events:timeline` to combine several parser outputs into a first
   `vault_event_timeline` JSON file.
4. Validate the draft `raw_events` table shape against parser outputs and the
   first `vault_event_timeline` transformer.
5. Add a second materialized read model for `tickets`, because withdraw tickets
   are the clearest example of state that can disappear from RPC after closure.
6. Draft read endpoint response DTOs from the materialized event data rather
   than from ad hoc RPC reads.
7. Revisit event gaps and `emit_cpi!` candidates before modifying Anchor event
   structs.
