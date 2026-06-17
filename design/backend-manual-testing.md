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

The module flow is tested in two layers:

- mock module on localnet, to validate the generic module interface without external protocol dependencies;
- Kamino USDC on Surfpool, to validate the same generic backend endpoints against real cloned Klend accounts.

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

For the Kamino USDC flow, use Surfpool against mainnet clones instead of a plain local validator. Run it from the Anchor workspace so the generated runbook can deploy the local programs:

```bash
cd /Users/edoardoalbertofumagalli/Projects/solana/training/week-2/solana-managed-vault/anchor_managed_vault

NO_DNA=1 surfpool start \
  --network mainnet \
  --no-tui \
  --yes \
  --watch \
  --airdrop-keypair-path "$HOME/.config/solana/id.json"
```

`--watch` lets Surfpool manage workspace program deploys while it is running. If your local programs are already deployed and you are not changing them, this can be dropped, but keeping it on is the simplest setup while iterating.

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
.tmp/register-module-transaction.json
.tmp/sync-module-nav-transaction.json
.tmp/deploy-to-module-transaction.json
.tmp/recall-from-module-transaction.json
.tmp/kamino-register-module-transaction.json
.tmp/kamino-sync-module-nav-transaction.json
.tmp/kamino-deposit-transaction.json
.tmp/kamino-deploy-to-module-transaction.json
.tmp/kamino-recall-from-module-transaction.json
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

Optional mock module setup:

```bash
npm run backend:fixture:setup -- \
  --execute \
  --include-mock-module \
  --output .tmp/backend-fixture.json
```

With `--include-mock-module`, the script also initializes the local mock yield module and writes ready-to-use request templates for the module backend endpoints. This optional mode requires the `mock_yield_module` program to be deployed on the selected local cluster. It does not register the module in the vault. Registration should still be tested through `POST /transactions/modules/register` when module inspect scripts are added.

Optional Kamino USDC setup:

```bash
npm run backend:fixture:setup -- \
  --execute \
  --setup-kamino-usdc-onchain \
  --output .tmp/backend-fixture.json
```

With `--setup-kamino-usdc-onchain`, the script validates the cloned Kamino/Klend USDC accounts, initializes the Kamino USDC vault if needed, initializes the Kamino module state if needed, creates the module token accounts idempotently, and writes ready-to-use request templates under `.modules.kaminoUsdc`.

The Kamino fixture uses:

- `amounts.suggestedModuleAmount` for deploy, default `100000`;
- `amounts.suggestedKaminoModuleRecallAmount` for recall, default `50000`.

The recall amount is intentionally smaller than the deploy amount. Kamino positions are represented through collateral tokens and reserve exchange-rate math. The module NAV rounds down, while recall computes collateral to redeem by rounding up, so a full recall of the original deploy amount can fail with `InsufficientCollateral` after normal exchange-rate rounding.

Useful fixture fields:

```bash
jq '.accounts' .tmp/backend-fixture.json
jq '.amounts' .tmp/backend-fixture.json
jq '.modules.mockYield.requests.register' .tmp/backend-fixture.json
jq '.modules.mockYield.remainingAccounts.deploy' .tmp/backend-fixture.json
jq '.modules.mockYield.remainingAccounts.recall' .tmp/backend-fixture.json
jq '.modules.kaminoUsdc.requests.deploy' .tmp/backend-fixture.json
jq '.modules.kaminoUsdc.requests.recall' .tmp/backend-fixture.json
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

## Module Step 1: Inspect Register Module

This step requires a fixture created with `--include-mock-module`.

Build and inspect a `register_module` transaction using the fixture's mock module request template:

```bash
npm run backend:modules:register:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --output .tmp/register-module-transaction.json
```

The script also supports explicit account arguments when you do not want to read from the fixture:

```bash
npm run backend:modules:register:inspect -- \
  --vault "$VAULT" \
  --manager "$USER" \
  --module-program "$(jq -r '.modules.mockYield.accounts.moduleProgram' .tmp/backend-fixture.json)" \
  --module-state "$(jq -r '.modules.mockYield.accounts.moduleState' .tmp/backend-fixture.json)" \
  --module-underlying-token-account "$(jq -r '.modules.mockYield.accounts.moduleUnderlyingTokenAccount' .tmp/backend-fixture.json)" \
  --policy-seed "$(jq -r '.modules.mockYield.policySeed' .tmp/backend-fixture.json)" \
  --simulate \
  --output .tmp/register-module-transaction.json
```

Expected checks:

- `summary.action` is `register_module`;
- `summary.actor.role` is `manager`;
- `summary.accounts` contains `module_entry`, `module_program`, `module_state`, and `module_underlying_token_account`;
- `summary.details.policySeed` matches the fixture policy seed;
- backend simulation has `ok: true`.

## Module Step 2: Sign And Send Register Module

```bash
npm run backend:tx:sign -- \
  --input .tmp/register-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After this transaction is confirmed, the module entry exists on-chain. That unlocks the next module inspect scripts for `sync-nav`, `deploy`, and `recall`.

## Module Step 3: Inspect Sync Module NAV

This step requires the module registration transaction to be confirmed first, because the backend fetches the `ModuleEntry` account before building the transaction.

Build and inspect a `sync_module_nav` transaction using the fixture's mock module request template:

```bash
npm run backend:modules:sync-nav:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --output .tmp/sync-module-nav-transaction.json
```

The script also supports explicit account arguments:

```bash
npm run backend:modules:sync-nav:inspect -- \
  --vault "$VAULT" \
  --module-entry "$(jq -r '.modules.mockYield.accounts.moduleEntry' .tmp/backend-fixture.json)" \
  --fee-payer "$USER" \
  --simulate \
  --output .tmp/sync-module-nav-transaction.json
```

Expected checks:

- `summary.action` is `sync_module_nav`;
- `summary.actor.role` is `cranker`;
- `summary.accounts` contains `module_entry`, `module_program`, and `module_state`;
- `summary.details.policySeed` matches the fixture policy seed;
- `summary.details.oldCachedNav` is the cached NAV read from `ModuleEntry` before syncing;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot for the fee payer/cranker.

`sync_module_nav` is permissionless at the vault-instruction level, but the Solana transaction still needs a fee payer signer. In the manual local flow, `--fee-payer "$USER"` keeps signing simple.

## Module Step 4: Sign And Send Sync Module NAV

```bash
npm run backend:tx:sign -- \
  --input .tmp/sync-module-nav-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

For the mock module immediately after registration, the cached NAV is usually still `0`, so this step may not visibly change vault accounting yet. It is still useful because it verifies the permissionless cranker transaction shape before testing deploy and recall.

## Module Step 5: Inspect Deploy To Module

This step requires:

- the module registration transaction to be confirmed;
- enough liquid underlying in the vault token account, usually from a successful backend deposit;
- fixture data created with `--include-mock-module`.

Build and inspect a `deploy_to_module` transaction using the fixture's mock deploy request template:

```bash
npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --output .tmp/deploy-to-module-transaction.json
```

You can override the fixture amount when you want to test a smaller or larger deploy:

```bash
npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --amount 100000 \
  --output .tmp/deploy-to-module-transaction.json
```

The default fixture uses `suggestedModuleAmount = 100000`. With the default
fixture deposit of `1000000` and `maxFloatBps = 2000`, this stays below the
20% deployed-value cap enforced by the vault. If you increase the deploy
amount, keep it below the current cap or the on-chain simulation can fail with
`FloatCapExceeded`.

The script also supports explicit account arguments. In explicit mode, pass ordered remaining accounts through a JSON file:

```bash
jq '.modules.mockYield.remainingAccounts.deploy' .tmp/backend-fixture.json > .tmp/mock-deploy-remaining-accounts.json

npm run backend:modules:deploy:inspect -- \
  --vault "$VAULT" \
  --manager "$USER" \
  --module-entry "$(jq -r '.modules.mockYield.accounts.moduleEntry' .tmp/backend-fixture.json)" \
  --amount 100000 \
  --remaining-accounts-file .tmp/mock-deploy-remaining-accounts.json \
  --simulate \
  --output .tmp/deploy-to-module-transaction.json
```

Expected checks:

- `summary.action` is `deploy_to_module`;
- `summary.actor.role` is `manager`;
- `summary.amounts` contains `module_underlying`;
- `summary.accounts` contains `module_entry`, `module_program`, `module_state`, `module_underlying_token_account`, `vault_token_account`, and `module_call_authority`;
- `summary.details.remainingAccountsCount` is `2` for the mock yield deploy fixture;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot for the manager.

For mock deploy, the forwarded `remainingAccounts` order is `mock_module_state` writable, then `module_token_account` writable. The backend preserves this order because the external module owns its own Anchor account order.

## Module Step 6: Sign And Send Deploy To Module

```bash
npm run backend:tx:sign -- \
  --input .tmp/deploy-to-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After deploy, the vault token account should decrease by the deployed amount, the module token account should receive that amount, and the module cached NAV should reflect the mock module token balance.

## Module Step 7: Inspect Recall From Module

This step requires a successful module deploy first. The recall amount must be less than or equal to the amount currently available in the module token account. If you deployed with an amount override, use the same or a smaller amount here.

Build and inspect a `recall_from_module` transaction using the fixture's mock recall request template:

```bash
npm run backend:modules:recall:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --output .tmp/recall-from-module-transaction.json
```

When the deployed amount was overridden, override the recall amount too:

```bash
npm run backend:modules:recall:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --amount 100000 \
  --output .tmp/recall-from-module-transaction.json
```

The script also supports explicit account arguments. In explicit mode, pass ordered remaining accounts through a JSON file:

```bash
jq '.modules.mockYield.remainingAccounts.recall' .tmp/backend-fixture.json > .tmp/mock-recall-remaining-accounts.json

npm run backend:modules:recall:inspect -- \
  --vault "$VAULT" \
  --manager "$USER" \
  --module-entry "$(jq -r '.modules.mockYield.accounts.moduleEntry' .tmp/backend-fixture.json)" \
  --amount 100000 \
  --remaining-accounts-file .tmp/mock-recall-remaining-accounts.json \
  --simulate \
  --output .tmp/recall-from-module-transaction.json
```

Expected checks:

- `summary.action` is `recall_from_module`;
- `summary.actor.role` is `manager`;
- `summary.amounts` contains `module_underlying`;
- `summary.accounts` contains `module_entry`, `module_program`, `module_state`, `vault_token_account`, and `module_call_authority`;
- `summary.details.remainingAccountsCount` is `6` for the mock yield recall fixture;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot for the manager.

For mock recall, the forwarded `remainingAccounts` order is `mock_module_state` writable, `mock_module_authority` readonly, `underlying_mint` readonly, `module_token_account` writable, `vault_token_account` writable, and `token_program` readonly.

## Module Step 8: Sign And Send Recall From Module

```bash
npm run backend:tx:sign -- \
  --input .tmp/recall-from-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After recall, the module token account should decrease by the recalled amount, the vault token account should increase by at least that amount, and the module cached NAV should decrease accordingly.

## Kamino USDC Surfpool Flow

This flow validates the same generic backend module endpoints against the real Kamino/Klend adapter. It requires Surfpool with mainnet cloned accounts and a fixture created with `--setup-kamino-usdc-onchain`.

The high-level sequence is:

```text
start Surfpool mainnet clone
    -> setup Kamino fixture
    -> fund manager USDC on Surfpool
    -> register Kamino module through backend
    -> sync module NAV through backend
    -> deposit USDC into the Kamino vault through backend
    -> deploy part of vault liquidity into Kamino through backend
    -> recall part of deployed liquidity through backend
```

### Kamino Step 1: Setup Fixture

```bash
npm run backend:fixture:setup -- \
  --execute \
  --setup-kamino-usdc-onchain \
  --output .tmp/backend-fixture.json
```

Useful variables:

```bash
MANAGER=$(node -p 'require("./.tmp/backend-fixture.json").manager')
KAMINO_VAULT=$(node -p 'require("./.tmp/backend-fixture.json").modules.kaminoUsdc.accounts.vault')
USDC_MINT=$(node -p 'require("./.tmp/backend-fixture.json").modules.kaminoUsdc.reserveAccounts.liquidityMint')
KAMINO_SHARE_MINT=$(node -p 'require("./.tmp/backend-fixture.json").modules.kaminoUsdc.accounts.shareMint')
KAMINO_DEPLOY_AMOUNT=$(node -p 'require("./.tmp/backend-fixture.json").modules.kaminoUsdc.requests.deploy.amount')
KAMINO_RECALL_AMOUNT=$(node -p 'require("./.tmp/backend-fixture.json").modules.kaminoUsdc.requests.recall.amount')
```

Expected defaults:

```text
KAMINO_DEPLOY_AMOUNT=100000
KAMINO_RECALL_AMOUNT=50000
```

### Kamino Step 2: Fund Manager USDC

The setup script initializes accounts, but the manager still needs local Surfpool USDC to deposit into the Kamino vault. Use Surfpool's local RPC override:

```bash
curl -sS http://127.0.0.1:8899 \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"surfnet_setTokenAccount\",\"params\":[\"$MANAGER\",\"$USDC_MINT\",{\"amount\":10000000}]}"
```

Create the manager share token account with zero balance if needed:

```bash
curl -sS http://127.0.0.1:8899 \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"surfnet_setTokenAccount\",\"params\":[\"$MANAGER\",\"$KAMINO_SHARE_MINT\",{\"amount\":0}]}"
```

### Kamino Step 3: Register Module

```bash
npm run backend:modules:register:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --output .tmp/kamino-register-module-transaction.json

npm run backend:tx:sign -- \
  --input .tmp/kamino-register-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

Expected checks:

- `summary.action` is `register_module`;
- `summary.accounts.module_program` is the Kamino yield module program;
- backend simulation has `ok: true`;
- the transaction confirms.

### Kamino Step 4: Sync Module NAV

```bash
npm run backend:modules:sync-nav:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --output .tmp/kamino-sync-module-nav-transaction.json

npm run backend:tx:sign -- \
  --input .tmp/kamino-sync-module-nav-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

Immediately after registration, `oldCachedNav` is usually `0`. This step is still useful because it verifies the generic `sync-nav` endpoint against the Kamino module entry.

### Kamino Step 5: Deposit Into Kamino Vault

```bash
npm run backend:deposit:inspect -- \
  --vault "$KAMINO_VAULT" \
  --user "$MANAGER" \
  --amount 10000000 \
  --simulate \
  --output .tmp/kamino-deposit-transaction.json

npm run backend:tx:sign -- \
  --input .tmp/kamino-deposit-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

This is a normal vault deposit, but against the USDC-backed Kamino vault created by the fixture.

### Kamino Step 6: Deploy To Kamino

```bash
npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --simulate \
  --output .tmp/kamino-deploy-to-module-transaction.json

npm run backend:tx:sign -- \
  --input .tmp/kamino-deploy-to-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

Expected checks:

- `summary.action` is `deploy_to_module`;
- `summary.amounts.module_underlying` matches `KAMINO_DEPLOY_AMOUNT`;
- `summary.details.remainingAccountsCount` is `18`;
- logs include Kamino `Deposit` and Klend `DepositReserveLiquidity`;
- simulation and signed send both succeed.

### Kamino Step 7: Recall From Kamino

```bash
npm run backend:modules:recall:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --simulate \
  --output .tmp/kamino-recall-from-module-transaction.json

npm run backend:tx:sign -- \
  --input .tmp/kamino-recall-from-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

Expected checks:

- `summary.action` is `recall_from_module`;
- `summary.amounts.module_underlying` matches `KAMINO_RECALL_AMOUNT`;
- `summary.details.remainingAccountsCount` is `19`;
- logs include Kamino `Withdraw` and Klend `RedeemReserveCollateral`;
- simulation and signed send both succeed.

If you override the recall amount, keep it below the current Kamino module NAV. A full recall of the exact deploy amount can fail with `InsufficientCollateral` because the deployed collateral position may be worth slightly less than the original raw underlying amount after integer rounding.

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
jq '.response.summary.details.oldCachedNav' .tmp/sync-module-nav-transaction.json
jq '.response.summary.details.remainingAccountsCount' .tmp/deploy-to-module-transaction.json
jq '.response.summary.details.remainingAccountsCount' .tmp/recall-from-module-transaction.json
jq '.response.summary' .tmp/kamino-deploy-to-module-transaction.json
jq '.response.summary' .tmp/kamino-recall-from-module-transaction.json
jq '.response.simulation.unitsConsumed' .tmp/kamino-recall-from-module-transaction.json
```

## Blockhash Expiry

Saved transaction builds are time-sensitive because they contain a recent blockhash.

If `sign_backend_transaction.js` says the blockhash is too close to expiry, rebuild the transaction by rerunning the matching inspect script. Do not patch the blockhash locally, because the backend response and transaction bytes are meant to stay consistent.

## Current Coverage

Covered:

- fixture setup for backend endpoint testing;
- optional mock module fixture data for module endpoint testing;
- Surfpool/Kamino USDC fixture data and manual backend flow;
- `POST /transactions/deposit`;
- `POST /transactions/request-withdraw`;
- `POST /transactions/cancel-withdraw`;
- `POST /transactions/process-withdraw`;
- `POST /transactions/modules/register` inspect script;
- `POST /transactions/modules/sync-nav` inspect script;
- `POST /transactions/modules/deploy` inspect script;
- `POST /transactions/modules/recall` inspect script;
- unsigned transaction inspection;
- saved transaction review;
- explicit local signing, simulation, send, and confirmation.

Not covered yet:

- manager endpoints;
- automated Kamino amount discovery or reserve discovery;
- automated assertions around the manual script flow.
