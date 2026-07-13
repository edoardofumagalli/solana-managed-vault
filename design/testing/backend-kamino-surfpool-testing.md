# Backend Kamino Surfpool Testing

## Purpose

This runbook validates the generic backend module endpoints against the real
Kamino/Klend adapter. It requires Surfpool with mainnet cloned accounts and a
fixture created with `--setup-kamino-usdc-onchain`.

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

Use the common prerequisites in [README.md](README.md) first.

## Start Surfpool

Run Surfpool from the Anchor workspace:

```bash
NO_DNA=1 surfpool start \
  --network mainnet \
  --no-tui \
  --yes \
  --watch \
  --airdrop-keypair-path "$HOME/.config/solana/id.json"
```

Keep the backend running against `http://127.0.0.1:8899`.

## Kamino Step 1: Setup Fixture

```bash
npm run backend:fixture:setup -- \
  --execute \
  --setup-kamino-usdc-onchain \
  --output .tmp/backend-fixture.json
```

With `--setup-kamino-usdc-onchain`, the script validates the cloned Kamino/Klend
USDC accounts, initializes the Kamino USDC vault if needed, initializes the
Kamino module state if needed, creates the module token accounts idempotently,
and writes ready-to-use request templates under `.modules.kaminoUsdc`.

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

Useful fixture fields:

```bash
jq '.modules.kaminoUsdc.requests.deploy' .tmp/backend-fixture.json
jq '.modules.kaminoUsdc.requests.recall' .tmp/backend-fixture.json
```

The recall amount is intentionally smaller than the deploy amount. Kamino
positions are represented through collateral tokens and reserve exchange-rate
math. The module NAV rounds down, while recall computes collateral to redeem by
rounding up, so a full recall of the original deploy amount can fail with
`InsufficientCollateral` after normal exchange-rate rounding.

## Kamino Step 2: Fund Manager USDC

The setup script initializes accounts, but the manager still needs local
Surfpool USDC to deposit into the Kamino vault. Use Surfpool's local RPC
override:

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

## Kamino Step 3: Register Module

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

## Kamino Step 4: Sync Module NAV

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

Immediately after registration, `oldCachedNav` is usually `0`. This step is
still useful because it verifies the generic `sync-nav` endpoint against the
Kamino module entry.

## Kamino Step 5: Deposit Into Kamino Vault

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

This is a normal vault deposit, but against the USDC-backed Kamino vault created
by the fixture.

## Kamino Step 6: Deploy To Kamino

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

Optional compute budget variants:

```bash
npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --simulate \
  --compute-budget-mode fixed \
  --compute-unit-limit 500000 \
  --output .tmp/kamino-deploy-to-module-fixed.json

npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --simulate \
  --compute-budget-mode auto \
  --compute-margin-bps 1000 \
  --output .tmp/kamino-deploy-to-module-auto.json
```

Use `fixed` first when debugging account routing because it avoids coupling the
test result to estimation. Use `auto` after the route works to verify that the
backend can estimate `unitsConsumed`, apply the margin, and return a final
transaction with compute budget instructions prepended.

## Kamino Step 7: Recall From Kamino

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

Optional compute budget variants:

```bash
npm run backend:modules:recall:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --simulate \
  --compute-budget-mode fixed \
  --compute-unit-limit 500000 \
  --output .tmp/kamino-recall-from-module-fixed.json

npm run backend:modules:recall:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --fixture-module kaminoUsdc \
  --simulate \
  --compute-budget-mode auto \
  --compute-margin-bps 1000 \
  --output .tmp/kamino-recall-from-module-auto.json
```

For `auto`, check:

```bash
jq '.response.computeBudget' .tmp/kamino-recall-from-module-auto.json
jq '.response.simulation.unitsConsumed' .tmp/kamino-recall-from-module-auto.json
```

If you override the recall amount, keep it below the current Kamino module NAV.
A full recall of the exact deploy amount can fail with `InsufficientCollateral`
because the deployed collateral position may be worth slightly less than the
original raw underlying amount after integer rounding.
