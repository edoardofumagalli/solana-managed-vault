# Backend Manual Testing

## Purpose

This guide documents the current local manual testing flow for the managed vault backend.

The backend builds unsigned Solana `VersionedTransaction` payloads. The scripts in `anchor_managed_vault/scripts` let us test that flow without turning it into one large end-to-end script:

- `setup_backend_fixture.ts` prepares local vault state and writes a fixture JSON file.
- one `inspect_*_transaction.js` script calls one backend endpoint and saves the returned unsigned transaction build.
- `sign_backend_transaction.js` reviews, validates, optionally signs, simulates, and sends a saved transaction build.

The current covered flow is:

```text
setup fixture
    -> inspect deposit
    -> sign/send deposit
    -> inspect request_withdraw
    -> sign/send request_withdraw
    -> choose one ticket outcome:
        -> inspect cancel_withdraw
        -> sign/send cancel_withdraw
        or
        -> inspect process_withdraw
        -> sign/send process_withdraw
```

## Prerequisites

Use localnet for this flow.

1. Start a local Solana validator or Surfpool instance on `http://127.0.0.1:8899`.
2. Deploy the Anchor managed vault program to that local cluster.
3. Start the backend in another terminal:

```bash
cd /Users/edoardoalbertofumagalli/Projects/solana/training/week-2/solana-managed-vault/backend
NO_DNA=1 cargo run
```

By default the backend listens on `http://127.0.0.1:8080` and reads RPC state from `http://127.0.0.1:8899`.

4. Run the script commands from the Anchor workspace:

```bash
cd /Users/edoardoalbertofumagalli/Projects/solana/training/week-2/solana-managed-vault/anchor_managed_vault
```

Optional environment variables:

```bash
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
export MANAGED_VAULT_BACKEND_URL=http://127.0.0.1:8080
```

## Local Output Files

The scripts write local run artifacts under `anchor_managed_vault/.tmp/`.

Expected files for the current flow:

```text
.tmp/backend-fixture.json
.tmp/deposit-transaction.json
.tmp/request-withdraw-transaction.json
.tmp/cancel-withdraw-transaction.json
.tmp/process-withdraw-transaction.json
```

`.tmp/` is ignored by git. These files are local test artifacts and should not be committed.

## Step 1: Setup Fixture

Create a fresh local vault, mint test underlying tokens to the user, and write the fixture file:

```bash
npm run backend:fixture:setup -- \
  --execute \
  --output .tmp/backend-fixture.json
```

The fixture setup script:

- creates a new underlying mint;
- derives the vault PDA;
- initializes the vault;
- creates the user's underlying and share token accounts;
- mints test underlying to the user;
- writes all addresses and suggested test amounts to `.tmp/backend-fixture.json`.

It does not deposit into the vault. Deposits are tested through the backend endpoint.

Useful fixture fields:

```bash
jq '.accounts' .tmp/backend-fixture.json
jq '.amounts' .tmp/backend-fixture.json
```

For convenience:

```bash
VAULT=$(jq -r '.accounts.vault' .tmp/backend-fixture.json)
USER=$(jq -r '.user' .tmp/backend-fixture.json)
DEPOSIT_AMOUNT=$(jq -r '.amounts.suggestedDeposit' .tmp/backend-fixture.json)
SHARES_AMOUNT=$(jq -r '.amounts.suggestedSharesToWithdraw' .tmp/backend-fixture.json)
FEE_PAYER="$USER"
```

## Step 2: Inspect Deposit

Ask the backend to build an unsigned deposit transaction, simulate it, print the decoded account metas, and save the raw backend response:

```bash
npm run backend:deposit:inspect -- \
  --vault "$VAULT" \
  --user "$USER" \
  --amount "$DEPOSIT_AMOUNT" \
  --simulate \
  --output .tmp/deposit-transaction.json
```

Expected checks:

- `summary.action` is `deposit`;
- `summary.amounts` contains `underlying`;
- `feePayer` and `requiredSigners[0]` match the user;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot.

## Step 3: Sign And Send Deposit

First, review the saved transaction without signing:

```bash
npm run backend:tx:sign -- \
  --input .tmp/deposit-transaction.json
```

Then sign, simulate with signature verification, send, and confirm:

```bash
npm run backend:tx:sign -- \
  --input .tmp/deposit-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After the deposit, the user should have fewer underlying tokens and more share tokens. With the default fixture amounts and 6 decimals, the expected user balances are:

```text
underlying: 0
shares:     1
```

You can check with:

```bash
spl-token accounts --owner "$USER" --url http://127.0.0.1:8899
```

The share balance shown by `spl-token` is UI-formatted. The raw amount used by backend requests is the base-unit amount. With 6 decimals, UI balance `1` means raw amount `1000000`.

## Step 4: Inspect Request Withdraw

Build and inspect a `request_withdraw` transaction:

```bash
npm run backend:request-withdraw:inspect -- \
  --vault "$VAULT" \
  --user "$USER" \
  --shares-amount "$SHARES_AMOUNT" \
  --simulate \
  --output .tmp/request-withdraw-transaction.json
```

Expected checks:

- `summary.action` is `request_withdraw`;
- `summary.amounts` contains `shares`;
- `summary.details.ticketIndex` is present;
- backend simulation has `ok: true`.

Save the ticket index for the cancel or process step:

```bash
TICKET_INDEX=$(jq -r '.response.summary.details.ticketIndex' .tmp/request-withdraw-transaction.json)
```

## Step 5: Sign And Send Request Withdraw

```bash
npm run backend:tx:sign -- \
  --input .tmp/request-withdraw-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

With the default fixture values, this requests withdrawal of `250000` raw share units. With 6 decimals, the user's visible share balance should move from `1` to `0.75`, because `0.25` shares are escrowed in the withdraw ticket.

After this step, choose either cancel or process for the pending ticket. A ticket can only be completed once. If you test cancel first and then want to test process, create a fresh fixture or submit a new withdrawal request.

## Step 6: Inspect Cancel Withdraw

Build and inspect the cancel transaction using the ticket index from the request response:

```bash
npm run backend:cancel-withdraw:inspect -- \
  --vault "$VAULT" \
  --user "$USER" \
  --ticket-index "$TICKET_INDEX" \
  --simulate \
  --output .tmp/cancel-withdraw-transaction.json
```

Expected checks:

- `summary.action` is `cancel_withdraw`;
- `summary.details.ticketIndex` matches the requested ticket;
- backend simulation has `ok: true`.

## Step 7: Sign And Send Cancel Withdraw

```bash
npm run backend:tx:sign -- \
  --input .tmp/cancel-withdraw-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After cancel, the escrowed shares should return to the user. With the default fixture values, the visible share balance should move from `0.75` back to `1`.

## Step 8: Inspect Process Withdraw

Build and inspect the process transaction using the ticket index from the request response:

```bash
npm run backend:process-withdraw:inspect -- \
  --vault "$VAULT" \
  --user "$USER" \
  --ticket-index "$TICKET_INDEX" \
  --fee-payer "$FEE_PAYER" \
  --simulate \
  --output .tmp/process-withdraw-transaction.json
```

Expected checks:

- `summary.action` is `process_withdraw`;
- `summary.actor.role` is `fee_payer`;
- `summary.accounts` contains `withdraw_user`;
- `summary.details.ticketIndex` matches the requested ticket;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot for the fee payer.

`process_withdraw` is permissionless at the vault-instruction level, but the Solana transaction still needs a fee payer signer. In the manual local flow, `FEE_PAYER="$USER"` keeps signing simple.

## Step 9: Sign And Send Process Withdraw

```bash
npm run backend:tx:sign -- \
  --input .tmp/process-withdraw-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After process, the escrowed shares are burned and underlying is paid back to the user's underlying token account. With the default fixture values, the visible share balance should stay at `0.75` and the visible underlying balance should move from `0` to `0.25`.

## Interpreting Saved Transaction Builds

Every inspect script writes a JSON file with schema:

```text
managed-vault.backendTransactionBuild.v1
```

The important top-level fields are:

- `request`: the HTTP request body sent to the backend;
- `response.transaction`: base64 serialized unsigned `VersionedTransaction`;
- `response.requiredSigners`: wallet public keys expected to sign;
- `response.feePayer`: transaction fee payer;
- `response.recentBlockhash` and `response.lastValidBlockHeight`: freshness window;
- `response.summary`: stable user-facing transaction summary;
- `response.simulation`: optional backend simulation result.

Useful commands:

```bash
jq '.response.summary' .tmp/deposit-transaction.json
jq '.response.simulation.ok' .tmp/request-withdraw-transaction.json
jq '.response.summary.details.ticketIndex' .tmp/cancel-withdraw-transaction.json
jq '.response.summary.details.ticketIndex' .tmp/process-withdraw-transaction.json
```

## Blockhash Expiry

Saved transaction builds are time-sensitive because they contain a recent blockhash.

If `sign_backend_transaction.js` says the blockhash is too close to expiry, rebuild the transaction by rerunning the matching inspect script. Do not patch the blockhash locally, because the backend response and transaction bytes are meant to stay consistent.

## Current Coverage

Covered:

- fixture setup for backend endpoint testing;
- `POST /transactions/deposit`;
- `POST /transactions/request-withdraw`;
- `POST /transactions/cancel-withdraw`;
- `POST /transactions/process-withdraw`;
- unsigned transaction inspection;
- saved transaction review;
- explicit local signing, simulation, send, and confirmation.

Not covered yet:

- manager endpoints;
- module deploy/recall endpoints;
- Kamino-specific backend flows;
- automated assertions around the manual script flow.
