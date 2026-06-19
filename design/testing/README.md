# Backend Testing Runbooks

## Purpose

This directory contains the manual backend testing runbooks for the managed
vault project.

The backend builds unsigned Solana `VersionedTransaction` payloads. The scripts
in `anchor_managed_vault/scripts` let us test one endpoint at a time without
turning the process into one large end-to-end script.

## Runbook Map

| File | Use When |
| --- | --- |
| [backend-user-flow-testing.md](backend-user-flow-testing.md) | You want to test the local user flow: fixture setup, deposit, request withdraw, cancel withdraw, or process withdraw. |
| [backend-module-testing.md](backend-module-testing.md) | You want to test generic module endpoints against the local mock yield module. |
| [backend-kamino-surfpool-testing.md](backend-kamino-surfpool-testing.md) | You want to test generic module endpoints against the real Kamino/Klend USDC adapter on Surfpool. |
| [backend-transaction-build-reference.md](backend-transaction-build-reference.md) | You want to inspect saved transaction build JSON files, understand blockhash expiry, or check current script coverage. |

## Common Prerequisites

Run local script commands from the Anchor workspace:

```bash
cd /Users/edoardoalbertofumagalli/Projects/solana/training/week-2/solana-managed-vault/anchor_managed_vault
```

Start the backend in another terminal:

```bash
cd /Users/edoardoalbertofumagalli/Projects/solana/training/week-2/solana-managed-vault/backend
NO_DNA=1 cargo run
```

By default the backend listens on `http://127.0.0.1:8080` and reads RPC state
from `http://127.0.0.1:8899`.

Optional environment variables:

```bash
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
export MANAGED_VAULT_BACKEND_URL=http://127.0.0.1:8080
```

## Localnet Setup

For user-flow and mock-module testing, use a local Solana validator or Surfpool
instance on `http://127.0.0.1:8899`, then deploy the local Anchor programs.

The mock-module flow requires both the managed vault program and
`mock_yield_module` to be deployed.

## Kamino Surfpool Setup

For the Kamino USDC flow, use Surfpool against mainnet clones instead of a plain
local validator. Run it from the Anchor workspace so Surfpool can deploy the
local programs while serving cloned accounts:

```bash
NO_DNA=1 surfpool start \
  --network mainnet \
  --no-tui \
  --yes \
  --watch \
  --airdrop-keypair-path "$HOME/.config/solana/id.json"
```

`--watch` lets Surfpool manage workspace program deploys while it is running. If
your local programs are already deployed and you are not changing them, this can
be dropped, but keeping it on is the simplest setup while iterating.

## Local Output Files

The scripts write local run artifacts under `anchor_managed_vault/.tmp/`.

Expected files for the current flows:

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

`.tmp/` is ignored by git. These files are local test artifacts and should not
be committed.

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
