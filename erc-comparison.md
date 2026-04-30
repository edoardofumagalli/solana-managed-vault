# ERC-4626 / ERC-7540 to Solana Account Model Comparison

Author: TODO
Date: TODO

## Goal

TODO: In one short paragraph, explain what this document compares and why this comparison matters for the managed vault program.

## 1. High-Level Summary

ERC-4626 standardizes the core model of a tokenized vault: users deposit an underlying asset and receive shares that represent a proportional claim on the vault's total managed assets. ERC-7540 extends this model for asynchronous flows, where withdrawals or redemptions may require a request phase before assets become claimable. On Solana, these ideas do not translate as a direct interface copy: instead of Solidity view functions returning values, an Anchor program stores state in accounts, validates explicitly passed accounts, and uses PDAs to represent vault state, token authorities, and withdrawal requests. The main design work is deciding which ERC concepts become on-chain accounts and instructions, and which become client-side or indexer-side calculations.

## 2. Concept Mapping

Fill in the table below.

| ERC-4626 / ERC-7540 concept | Solana / Anchor equivalent | Direct translation or redesign? | Notes |
|---|---|---|---|
| `asset()` | `underlying_mint` stored in `VaultState` | Direct translation | The vault accepts one SPL mint, fixed at initialization and enforced by account constraints. |
| Share token / vault token | SPL share mint controlled by the vault PDA | Direct translation with Solana authority model | Shares are SPL tokens. The vault PDA acts as mint authority instead of the program owning balances internally. |
| `totalAssets()` | `vault_token_account.amount + vault_state.float_outstanding` | Direct translation with account reads | Idle tokens plus manager-deployed float represent total managed assets. |
| `convertToShares` | Internal math helper and client-side quote calculation | Redesign | Solana instructions do not return view values, so clients/tests compute quotes from accounts while the program reuses the same math during `deposit`. |
| `convertToAssets` | Internal math helper and client-side quote calculation | Redesign | Used by `process_withdraw` to calculate assets from ticket shares at processing time. |
| `maxWithdraw` | Client/indexer calculation plus on-chain enforcement | Redesign | Compute from user shares, total share supply, total assets, and idle vault liquidity. `process_withdraw` must still verify liquidity. |
| `maxRedeem` | Client/indexer calculation plus on-chain enforcement | Redesign | Limited by user share balance and, for immediate processing, by available vault liquidity. |
| `previewDeposit` / `previewWithdraw` | Client helper, tests, or transaction simulation | Redesign | Preview logic should mirror program math exactly, including rounding down. |
| `deposit` | Anchor `deposit` instruction with SPL transfer CPI and mint-to CPI | Mostly direct translation | User transfers underlying into the vault token account and receives newly minted shares. |
| `withdraw` / `redeem` | `request_withdraw` followed by `process_withdraw` | Redesign | This vault is asynchronous because liquidity may be deployed as manager float. |
| ERC-7540 `requestWithdraw` / `requestRedeem` | Anchor `request_withdraw` instruction | Mostly direct translation | Creates durable withdrawal state and removes shares from free user control by burning or escrowing them. |
| ERC-7540 `requestId` | Withdraw ticket PDA | Redesign | A PDA can be derived from vault, user, and nonce/index, allowing multiple pending tickets per user. |
| `pendingRedeemRequest` | `WithdrawTicket` account in pending state | Direct translation with account storage | The ticket stores vault, user, shares, requested slot, and bump. |
| `claimableRedeemRequest` | Liquidity-satisfied ticket or optional claimable status | Redesign | The first version can determine claimability at `process_withdraw`; a later version could store an explicit status. |
| Operator pattern | Optional approval/operator PDA | Redesign / stretch goal | The core task can keep requests user-owned; delegated operators require extra approval state. |
| Events | Anchor `#[event]` logs | Direct translation with Solana logging | Emit enough data for an indexer to reconstruct deposits, requests, processing, manager float, and manager updates. |

## 3. What Translates Directly?

The share/assets exchange-rate model translates directly. Users deposit an underlying asset and receive vault shares that represent a proportional claim on the vault's managed assets. The same two conversions remain central:

```text
shares_out = assets_in * total_share_supply / total_assets
assets_out = shares_in * total_assets / total_share_supply
```

The meaning of `totalAssets()` also translates cleanly. In this program, total managed assets are the tokens currently held by the vault plus the capital that the manager has withdrawn and not yet returned:

```text
total_assets = vault_token_account.amount + float_outstanding
```

The rounding direction can also be copied from ERC-4626. Deposits should round down when calculating shares, and withdrawals should round down when calculating assets. This means the user receives slightly less in cases where integer division is not exact, which protects the vault from losing value through rounding.

Finally, the basic lifecycle maps well: deposit asset, mint share, later redeem share for asset. The implementation details are Solana-specific, but the economic relationship between asset holders, share holders, total supply, and total managed assets stays the same.

## 4. What Needs Redesign?

The main redesign is around read-only functions. ERC-4626 exposes methods like `totalAssets`, `convertToShares`, `convertToAssets`, `maxWithdraw`, and preview functions as contract calls that return values. In Solana, the program state is stored in accounts, so these values are usually calculated by reading the relevant accounts and applying the same math off-chain. The Anchor program should still enforce the rules during state-changing instructions, but it does not need to expose every quote as an instruction.

Preview logic should therefore live primarily in the client, tests, or an indexer. For example, a client can read `VaultState`, the vault token account, the share mint, and the user's share token account to compute a deposit or withdrawal quote. Tests should verify that these client-side calculations match the exact on-chain math, especially rounding behavior.

The account model also needs redesign. In Solidity, the vault contract can read its own storage and token balances directly. In Solana, each instruction must receive the accounts it needs: vault state, underlying mint, share mint, vault token account, user token accounts, token program, and any ticket account involved in a withdrawal. Anchor constraints then validate that the passed accounts match the expected mint, owner, PDA seeds, and authorities.

ERC-7540 request tracking also changes shape. A `requestId` is just an identifier in the ERC interface, but on Solana a withdrawal request should usually become durable account state, such as a `WithdrawTicket` PDA. This makes each pending request independently processable, inspectable, cancellable if allowed, and indexable, but it also means each request pays rent and consumes account storage.

Finally, claimability is not only a function of user shares. Because this vault allows manager float, the vault can have enough total assets but not enough idle liquidity in its token account. That means `process_withdraw` must check current vault liquidity at execution time, and a request may remain pending until capital is returned.

## 5. Required Question: `maxWithdraw`

ERC-4626 uses return values. Solana uses accounts. How does `maxWithdraw(owner)` translate for this vault?

On Solana, `maxWithdraw(owner)` should be treated as a deterministic account-based calculation, not as a required on-chain return value. A client or indexer can compute it by reading the vault state, vault token account, share mint, and owner's share token account.

The owner's theoretical claim is based on their share balance:

```text
owner_assets = owner_shares * total_assets / total_share_supply
```

However, this vault may not have all assets immediately available because some assets can be deployed as manager float. Therefore immediate withdrawable liquidity is limited by the tokens actually sitting in the vault token account:

```text
max_withdraw_now = min(owner_assets, vault_token_account.amount)
```

The calculation can happen off-chain for previews and UI, but the program must enforce the same constraint during `process_withdraw`. In other words, off-chain `maxWithdraw` is informational; on-chain liquidity checks are authoritative.

## 6. Required Question: `requestId`

ERC-7540 uses `requestId`. On Solana, do you use a PDA per request?

Yes, this vault should use one PDA per withdrawal request. A natural seed pattern is:

```text
["withdraw_ticket", vault.key(), user.key(), ticket_index]
```

where `ticket_index` comes from `vault_state.total_tickets` or a per-user nonce. This allows the same user to have multiple pending withdrawal requests at the same time without address collisions.

The benefit of one PDA per request is that each ticket is independently inspectable, processable, and cancellable if cancellation is supported. It also makes indexing straightforward because each ticket stores its own `vault`, `user`, `shares`, `requested_slot`, and bump.

The tradeoff is account rent and state growth. Every request creates an on-chain account, so spam is possible if users are willing to pay rent. For this task, rent is a useful natural deterrent, but the program can also reject zero-share or dust requests to reduce useless tickets.

## 7. Required Question: `uint256` vs `u64`

ERC-4626's rounding rules assume `uint256`. This Solana program uses `u64` token amounts and `u128` intermediate math. Where does precision loss hit harder?

Precision loss matters more on Solana because final token amounts and share amounts are `u64`, while ERC-4626 implementations usually assume much larger `uint256` arithmetic. The program should use `u128` for intermediate multiplication, divide last, then safely cast back to `u64`.

The riskiest cases are tiny deposits and tiny withdrawals. A small deposit can round down to zero shares:

```text
shares_out = assets_in * total_share_supply / total_assets
```

Likewise, a small withdrawal can round down to zero assets:

```text
assets_out = shares_in * total_assets / total_share_supply
```

The program should reject operations that produce zero shares or zero assets unless zero-output behavior is intentionally documented. Otherwise, users could lose funds to rounding in a way that is technically valid but bad UX.

Rounding dust can also accumulate over many transactions. Since ERC-4626 rounds against the user, that dust stays in the vault and slightly benefits remaining shareholders. This is acceptable if it is intentional and consistently documented.

Overflow is another important difference. Even though inputs are `u64`, multiplying two `u64` values can overflow `u64`, so formulas should use checked `u128` math and return explicit errors on overflow, division by zero, or invalid zero-output results.

## References

- ERC-4626: https://eips.ethereum.org/EIPS/eip-4626
- ERC-7540: https://eips.ethereum.org/EIPS/eip-7540
