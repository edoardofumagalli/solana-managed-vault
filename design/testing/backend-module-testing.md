# Backend Mock Module Testing

## Purpose

This runbook covers the local mock module flow:

```text
setup fixture with mock module
    -> register module
    -> sync module NAV
    -> deposit into the vault
    -> deploy to module
    -> recall from module
```

Use the common prerequisites in [README.md](README.md) first. The local cluster
must have both the managed vault program and `mock_yield_module` deployed.

## Step 1: Setup Fixture With Mock Module

Create a fresh local vault and initialize the local mock yield module:

```bash
npm run backend:fixture:setup -- \
  --execute \
  --include-mock-module \
  --output .tmp/backend-fixture.json
```

With `--include-mock-module`, the script initializes the local mock yield module
and writes ready-to-use request templates for the module backend endpoints. It
does not register the module in the vault. Registration should still be tested
through `POST /transactions/modules/register`.

Useful fixture fields:

```bash
jq '.accounts' .tmp/backend-fixture.json
jq '.amounts' .tmp/backend-fixture.json
jq '.modules.mockYield.requests.register' .tmp/backend-fixture.json
jq '.modules.mockYield.remainingAccounts.deploy' .tmp/backend-fixture.json
jq '.modules.mockYield.remainingAccounts.recall' .tmp/backend-fixture.json
```

For convenience:

```bash
VAULT=$(jq -r '.accounts.vault' .tmp/backend-fixture.json)
USER=$(jq -r '.user' .tmp/backend-fixture.json)
DEPOSIT_AMOUNT=$(jq -r '.amounts.suggestedDeposit' .tmp/backend-fixture.json)
```

Before deploy, the vault needs liquid assets. Follow the deposit steps in
[backend-user-flow-testing.md](backend-user-flow-testing.md), then return here.

## Module Step 1: Inspect Register Module

Build and inspect a `register_module` transaction using the fixture's mock
module request template:

```bash
npm run backend:modules:register:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --output .tmp/register-module-transaction.json
```

The script also supports explicit account arguments when you do not want to read
from the fixture:

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
- `summary.accounts` contains `module_entry`, `module_program`, `module_state`,
  and `module_underlying_token_account`;
- `summary.details.policySeed` matches the fixture policy seed;
- backend simulation has `ok: true`.

## Module Step 2: Sign And Send Register Module

```bash
npm run backend:tx:sign -- \
  --input .tmp/register-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After this transaction is confirmed, the module entry exists on-chain. That
unlocks the next module inspect scripts for `sync-nav`, `deploy`, and `recall`.

## Module Step 3: Inspect Sync Module NAV

This step requires the module registration transaction to be confirmed first,
because the backend fetches the `ModuleEntry` account before building the
transaction.

Build and inspect a `sync_module_nav` transaction using the fixture's mock module
request template:

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
- `summary.accounts` contains `module_entry`, `module_program`, and
  `module_state`;
- `summary.details.policySeed` matches the fixture policy seed;
- `summary.details.oldCachedNav` is the cached NAV read from `ModuleEntry`
  before syncing;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot for the fee payer/cranker.

`sync_module_nav` is permissionless at the vault-instruction level, but the
Solana transaction still needs a fee payer signer. In the manual local flow,
`--fee-payer "$USER"` keeps signing simple.

## Module Step 4: Sign And Send Sync Module NAV

```bash
npm run backend:tx:sign -- \
  --input .tmp/sync-module-nav-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

For the mock module immediately after registration, the cached NAV is usually
still `0`, so this step may not visibly change vault accounting yet. It is still
useful because it verifies the permissionless cranker transaction shape before
testing deploy and recall.

## Module Step 5: Inspect Deploy To Module

This step requires:

- the module registration transaction to be confirmed;
- enough liquid underlying in the vault token account, usually from a successful
  backend deposit;
- fixture data created with `--include-mock-module`.

Build and inspect a `deploy_to_module` transaction using the fixture's mock
deploy request template:

```bash
npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --output .tmp/deploy-to-module-transaction.json
```

You can override the fixture amount when you want to test a smaller or larger
deploy:

```bash
npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --amount 100000 \
  --output .tmp/deploy-to-module-transaction.json
```

The default fixture uses `suggestedModuleAmount = 100000`. With the default
fixture deposit of `1000000` and `maxFloatBps = 2000`, this stays below the 20%
deployed-value cap enforced by the vault. If you increase the deploy amount,
keep it below the current cap or the on-chain simulation can fail with
`FloatCapExceeded`.

The script also supports explicit account arguments. In explicit mode, pass
ordered remaining accounts through a JSON file:

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
- `summary.accounts` contains `module_entry`, `module_program`, `module_state`,
  `module_underlying_token_account`, `vault_token_account`, and
  `module_call_authority`;
- `summary.details.remainingAccountsCount` is `2` for the mock yield deploy
  fixture;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot for the manager.

For mock deploy, the forwarded `remainingAccounts` order is `mock_module_state`
writable, then `module_token_account` writable. The backend preserves this order
because the external module owns its own Anchor account order.

Optional compute budget checks:

```bash
npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --simulate \
  --compute-budget-mode fixed \
  --compute-unit-limit 150000 \
  --output .tmp/deploy-to-module-fixed.json

npm run backend:modules:deploy:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --simulate \
  --compute-budget-mode auto \
  --compute-margin-bps 1000 \
  --output .tmp/deploy-to-module-auto.json
```

For `fixed`, `response.computeBudget.requestedUnits` should equal `150000`.
For `auto`, the response should include both `estimatedUnits` and
`requestedUnits`. The final diagnostic simulation, when `--simulate` is passed,
simulates the transaction after compute budget instructions have been inserted.

## Module Step 6: Sign And Send Deploy To Module

```bash
npm run backend:tx:sign -- \
  --input .tmp/deploy-to-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After deploy, the vault token account should decrease by the deployed amount,
the module token account should receive that amount, and the module cached NAV
should reflect the mock module token balance.

## Module Step 7: Inspect Recall From Module

This step requires a successful module deploy first. The recall amount must be
less than or equal to the amount currently available in the module token account.
If you deployed with an amount override, use the same or a smaller amount here.

Build and inspect a `recall_from_module` transaction using the fixture's mock
recall request template:

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

The script also supports explicit account arguments. In explicit mode, pass
ordered remaining accounts through a JSON file:

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
- `summary.accounts` contains `module_entry`, `module_program`,
  `module_state`, `vault_token_account`, and `module_call_authority`;
- `summary.details.remainingAccountsCount` is `6` for the mock yield recall
  fixture;
- backend simulation has `ok: true`;
- decoded transaction has one signature slot for the manager.

For mock recall, the forwarded `remainingAccounts` order is `mock_module_state`
writable, `mock_module_authority` readonly, `underlying_mint` readonly,
`module_token_account` writable, `vault_token_account` writable, and
`token_program` readonly.

Optional compute budget checks:

```bash
npm run backend:modules:recall:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --simulate \
  --compute-budget-mode fixed \
  --compute-unit-limit 150000 \
  --output .tmp/recall-from-module-fixed.json

npm run backend:modules:recall:inspect -- \
  --fixture .tmp/backend-fixture.json \
  --simulate \
  --compute-budget-mode auto \
  --compute-margin-bps 1000 \
  --output .tmp/recall-from-module-auto.json
```

The compute budget object is top-level response metadata, separate from the
vault action `summary`.

## Module Step 8: Sign And Send Recall From Module

```bash
npm run backend:tx:sign -- \
  --input .tmp/recall-from-module-transaction.json \
  --send \
  --wallet "$HOME/.config/solana/id.json"
```

After recall, the module token account should decrease by the recalled amount,
the vault token account should increase by at least that amount, and the module
cached NAV should decrease accordingly.
