# Kamino Surfpool Test Fixture

This document records the first Kamino/Klend target used for Surfpool integration tests and the account sets required by the vault's generic module interface.

## Target Reserve

The first target is Kamino Main Market SOL token-mode lending.

| Name | Pubkey | Notes |
| --- | --- | --- |
| Klend program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | External program invoked by `kamino_yield_module`. |
| Kamino main market | `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` | Lending market stored in `ModuleConfig` / `KaminoModuleState`. |
| SOL reserve | `d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q` | Reserve stored in `ModuleConfig` / `KaminoModuleState`. |
| Underlying mint | `So11111111111111111111111111111111111111112` | WSOL mint. Easier for local funding than USDC because wrapping SOL can be done locally. |

## Klend-Derived Accounts

These accounts are derived from `KLEND_PROGRAM_ID` and the selected reserve/market. They are encoded in `tests/fixtures/kamino.ts`.

| Name | Seeds | Used By |
| --- | --- | --- |
| Lending market authority | `[b"lma", lending_market]` | `deposit` and `withdraw`. Klend validates it. |
| Reserve liquidity supply | `[b"reserve_liq_supply", reserve]` | Receives liquidity on deposit, sends liquidity on redeem. |
| Reserve collateral mint | `[b"reserve_coll_mint", reserve]` | Mint for collateral/kTokens received by the module. |
| Reserve collateral supply | `[b"reserve_coll_supply", reserve]` | Not used by current token-mode deposit/withdraw, but useful for future obligation mode. |
| Reserve fee receiver | `[b"fee_receiver", reserve]` | Not used by current token-mode deposit/withdraw. |

## Oracle Accounts

`kamino_yield_module` reads the reserve configuration with `klend_interface::ReserveInfo::from_account_data` and validates four optional oracle accounts:

| Name | Account field |
| --- | --- |
| Pyth oracle | `pyth_oracle` |
| Switchboard price oracle | `switchboard_price_oracle` |
| Switchboard TWAP oracle | `switchboard_twap_oracle` |
| Scope prices | `scope_prices` |

If one of these is configured in the reserve, the caller must pass that exact account. If it is not configured, the caller must pass `KLEND_PROGRAM_ID` as the placeholder expected by `klend-interface`.

These values are intentionally not hardcoded yet. The next step is a discovery helper/test that loads the reserve through Surfpool and resolves the exact oracle pubkeys.

## Local Test Accounts

These are created by the test setup and are not cloned from mainnet.

| Name | Owner / Derivation | Notes |
| --- | --- | --- |
| Vault | Vault PDA | Created by `initialize_vault`. |
| Vault token account | ATA owned by vault PDA | Holds idle WSOL. |
| Module entry | Vault PDA `[module_entry, vault, module_program, policy_seed]` | Registers the Kamino module. |
| Module call authority | Vault PDA `[module_call_authority, vault]` | Prepended by the vault when doing raw CPI into the module. |
| Module config | Kamino module PDA `[module_config, vault]` | Stores target market/reserve/module type. |
| Kamino module state | Kamino module PDA `[kamino_module_state, vault]` | Stores standard NAV header plus Kamino-specific config. |
| Module underlying token account | Token account owned by `kamino_module_state` | Staging account funded by `deploy_to_module` before calling module deposit. |
| Vault collateral account | Token account owned by `kamino_module_state` | Receives reserve collateral/kTokens. |

## Remaining Accounts For `deploy_to_module` -> Kamino `deposit(amount)`

The vault prepends `module_call_authority` as signer. The caller must pass the following remaining accounts in this exact module order:

1. `module_config` readonly
2. `kamino_module_state` writable
3. `kamino_reserve` writable
4. `lending_market` readonly
5. `lending_market_authority` readonly
6. `pyth_oracle` readonly or `KLEND_PROGRAM_ID` placeholder
7. `switchboard_price_oracle` readonly or `KLEND_PROGRAM_ID` placeholder
8. `switchboard_twap_oracle` readonly or `KLEND_PROGRAM_ID` placeholder
9. `scope_prices` readonly or `KLEND_PROGRAM_ID` placeholder
10. `reserve_liquidity_mint` readonly
11. `reserve_liquidity_supply` writable
12. `reserve_collateral_mint` writable
13. `module_underlying_token_account` writable
14. `vault_collateral_account` writable
15. `token_program` readonly
16. `liquidity_token_program` readonly
17. `klend_program` readonly
18. `instruction_sysvar` readonly

## Remaining Accounts For `recall_from_module` -> Kamino `withdraw(amount)`

The vault prepends `module_call_authority` as signer. The caller must pass the following remaining accounts in this exact module order:

1. `module_config` readonly
2. `kamino_module_state` writable
3. `lending_market` readonly
4. `kamino_reserve` writable
5. `lending_market_authority` readonly
6. `pyth_oracle` readonly or `KLEND_PROGRAM_ID` placeholder
7. `switchboard_price_oracle` readonly or `KLEND_PROGRAM_ID` placeholder
8. `switchboard_twap_oracle` readonly or `KLEND_PROGRAM_ID` placeholder
9. `scope_prices` readonly or `KLEND_PROGRAM_ID` placeholder
10. `reserve_liquidity_mint` readonly
11. `reserve_collateral_mint` writable
12. `reserve_liquidity_supply` writable
13. `vault_collateral_account` writable
14. `vault_token_account` writable
15. `token_program` readonly
16. `liquidity_token_program` readonly
17. `klend_program` readonly
18. `instruction_sysvar` readonly

## Smoke Test

The first Surfpool smoke test is `tests/kamino_surfpool_smoke.ts`. It is gated by `RUN_SURFPOOL_KAMINO=1`, so normal `anchor test` runs do not execute it.

The test:

1. Reads the real SOL reserve through Surfpool.
2. Verifies the reserve is owned by Klend.
3. Creates a local SPL token account with a nonzero balance to act as the token-mode position input.
4. Initializes a local Kamino module state pointing at the real reserve.
5. Calls `calculate_nav` using the local nonzero token amount priced against the real reserve.
6. Asserts that cached NAV becomes positive.

This is intentionally not the end-to-end deposit/withdraw test and does not model a real Kamino collateral position. It only proves that the local program can read realistic Kamino reserve state and execute the NAV pricing path against Surfpool-cloned reserve data.

Run flow:

```bash
surfpool start --network mainnet --no-deploy
```

In another terminal, deploy only the Kamino module needed by this smoke test, then run:

```bash
anchor deploy --program-name kamino_yield_module --provider.cluster http://127.0.0.1:8899 --provider.wallet $HOME/.config/solana/id.json
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:kamino:surfpool
```

For agent, CI, or other non-interactive runs, prefix the CLI commands with `NO_DNA=1` to disable interactive/TUI behavior and make output more automation-friendly:

```bash
NO_DNA=1 surfpool start --network mainnet --no-deploy
NO_DNA=1 anchor deploy --program-name kamino_yield_module --provider.cluster http://127.0.0.1:8899 --provider.wallet $HOME/.config/solana/id.json
```

## Oracle Discovery

Before testing real Kamino `deposit` / `withdraw`, run the ignored discovery helper against Surfpool:

```bash
surfpool start --network mainnet --no-deploy
```

In another terminal:

```bash
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 npm run discover:kamino:oracles
```

The helper fetches `KAMINO_SOL_RESERVE`, verifies that it is owned by Klend, decodes it with `klend_interface::ReserveInfo::from_account_data`, and prints the exact `KaminoReserveOracleAccounts` snippet to copy into `tests/fixtures/kamino.ts`.

## Deposit Smoke Test

The first real Kamino deposit integration test is `tests/kamino_surfpool_deposit.ts`. It cannot call `kamino_yield_module.deposit` directly from the client, because the module intentionally requires `module_call_authority` to be a PDA signer produced by the vault program. Therefore the test uses the smallest valid production path:

```text
managed vault deploy_to_module -> raw CPI -> kamino_yield_module.deposit -> Klend deposit_reserve_liquidity
```

Run it with Surfpool mainnet fork active and both local programs deployed:

```bash
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:kamino:surfpool:deposit
```

The test wraps local SOL into WSOL, deposits it into the vault, deploys a smaller amount into the Kamino SOL reserve, and verifies that collateral tokens increase and cached NAV is updated.

## Next Test Step

Add the symmetric `withdraw` / recall test. It should start from the deposited Kamino position, call `recall_from_module`, verify that WSOL returns to the vault token account, and check that both `ModuleEntry.cached_nav` and `Vault.modules_nav_total` are updated.
