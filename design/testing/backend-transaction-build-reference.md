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
- `response.summary`: stable user-facing transaction summary;
- `response.simulation`: optional backend simulation result.

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
