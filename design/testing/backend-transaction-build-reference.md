# Backend Transaction Build Reference

## Purpose

This file explains how to inspect saved backend transaction build JSON files and
how to reason about blockhash freshness.

It applies to the user, mock module, and Kamino Surfpool runbooks in this
directory.

## Saved Transaction Build Schema

Every inspect script writes a JSON file with schema:

```text
managed-vault.backendTransactionBuild.v1
```

The important top-level fields are:

- `request`: the HTTP request body sent to the backend;
- `response.transaction`: base64 serialized unsigned `VersionedTransaction`;
- `response.requiredSigners`: wallet public keys expected to sign;
- `response.feePayer`: transaction fee payer;
- `response.recentBlockhash` and `response.lastValidBlockHeight`: freshness
  window;
- `response.computeBudget`: optional metadata describing compute budget
  instructions inserted by the backend;
- `response.summary`: stable user-facing transaction summary;
- `response.simulation`: optional backend simulation result.

## Compute Budget Fields

Supported inspect scripts can pass compute budget options to the backend:

```bash
--compute-budget-mode none|fixed|auto
--compute-unit-limit <units>
--compute-margin-bps <basis_points>
--compute-unit-price-micro-lamports <micro_lamports>
```

The currently supported endpoints are:

- `deposit`;
- `request_withdraw`;
- `cancel_withdraw`;
- `process_withdraw`;
- `modules/deploy`;
- `modules/recall`.

`none` is the default and does not add compute budget instructions.

`fixed` requires `--compute-unit-limit` and inserts
`SetComputeUnitLimit(unitLimit)`. If
`--compute-unit-price-micro-lamports` is greater than zero, the backend also
inserts `SetComputeUnitPrice(microLamports)`.

`auto` estimates compute units by simulating an internal provisional
transaction, applies `marginBps`, and inserts the resulting
`SetComputeUnitLimit`. With `--simulate`, the backend then simulates the final
transaction and returns that result in `response.simulation`.

Useful checks:

```bash
jq '.request.computeBudget' .tmp/deploy-to-module-auto.json
jq '.response.computeBudget' .tmp/deploy-to-module-auto.json
jq '.response.computeBudget.estimatedUnits' .tmp/deploy-to-module-auto.json
jq '.response.computeBudget.requestedUnits' .tmp/deploy-to-module-auto.json
jq '.response.simulation.unitsConsumed' .tmp/deploy-to-module-auto.json
```

`response.computeBudget.estimatedUnits` is present only for `auto` mode.
`response.computeBudget.requestedUnits` is the final compute unit limit encoded
in the returned transaction.

## Useful Inspection Commands

```bash
jq '.response.summary' .tmp/deposit-transaction.json
jq '.response.simulation.ok' .tmp/request-withdraw-transaction.json
jq '.response.summary.details.ticketIndex' .tmp/cancel-withdraw-transaction.json
jq '.response.summary.details.ticketIndex' .tmp/process-withdraw-transaction.json
jq '.response.summary.details.oldCachedNav' .tmp/sync-module-nav-transaction.json
jq '.response.summary.details.remainingAccountsCount' .tmp/deploy-to-module-transaction.json
jq '.response.summary.details.remainingAccountsCount' .tmp/recall-from-module-transaction.json
jq '.response.summary' .tmp/kamino-deploy-to-module-transaction.json
jq '.response.summary' .tmp/kamino-recall-from-module-transaction.json
jq '.response.computeBudget' .tmp/kamino-deploy-to-module-auto.json
jq '.response.computeBudget' .tmp/kamino-recall-from-module-auto.json
jq '.response.simulation.unitsConsumed' .tmp/kamino-recall-from-module-transaction.json
```

## Blockhash Expiry

Saved transaction builds are time-sensitive because they contain a recent
blockhash.

If `sign_backend_transaction.js` says the blockhash is too close to expiry,
rebuild the transaction by rerunning the matching inspect script. Do not patch
the blockhash locally, because the backend response and transaction bytes are
meant to stay consistent.

## Signing Boundary

The backend does not sign or send user transactions.

The local signing script is intentionally separate:

```bash
npm run backend:tx:sign -- \
  --input .tmp/deposit-transaction.json
```

Add `--send` only when you explicitly want to sign, simulate, submit, and
confirm:

```bash
npm run backend:tx:sign -- \
  --input .tmp/deposit-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

Before signing, the script verifies the saved response schema, required signer,
fee payer, transaction blockhash, and `lastValidBlockHeight`.

Before sending, it simulates the signed transaction and aborts if simulation
fails.
