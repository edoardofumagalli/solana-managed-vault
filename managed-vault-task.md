# Task: Managed Vault Program (Solana / Anchor)

## Background Reading (Required Before Coding)

### ERC-4626 — Tokenized Vault Standard
- **Spec**: https://eips.ethereum.org/EIPS/eip-4626
- **Why**: This is the canonical vault interface on EVM. It defines the share/asset model you'll be implementing. Read the full spec — not a blog post, the actual EIP. Pay attention to:
  - `convertToShares` / `convertToAssets` — this is your share math
  - `maxWithdraw` / `maxRedeem` — how the vault communicates available liquidity
  - `totalAssets` — includes assets deployed elsewhere, not just what's in the contract. This is exactly your `vault_balance + float_outstanding`
  - The rounding rules: deposits round *down* (fewer shares), withdrawals round *down* (less underlying). This protects the vault, not the user. Understand why.
  - Preview functions (`previewDeposit`, `previewWithdraw`) — the idea that you can quote a price before executing

### ERC-7540 — Asynchronous Redemption Tokenized Vaults
- **Spec**: https://eips.ethereum.org/EIPS/eip-7540
- **Why**: This extends ERC-4626 with async withdraw/redeem flows — exactly the queue pattern you're building. Study:
  - `requestRedeem` / `requestWithdraw` — the two-step model
  - The `operator` pattern — who can process requests on behalf of users
  - The `claimableRedeemRequest` / `pendingRedeemRequest` split — how the vault distinguishes between "queued" and "ready to claim"
  - The design rationale section explaining *why* synchronous redemptions break for vaults with illiquid strategies

### Deliverable
Before writing any code, write a **1-page comparison doc**: how would you map ERC-4626 + ERC-7540 concepts to Solana's account model? What translates directly, what doesn't, and what do you need to redesign? Specifically address:
- ERC-4626 uses return values. Solana uses accounts. How does `maxWithdraw` translate?
- ERC-7540 uses `requestId`. On Solana, do you use a PDA per request? What are the tradeoffs?
- ERC-4626's rounding rules assume `uint256`. You have `u64`. Where does precision loss hit harder?

---

## Program Specification

### Overview

A tokenized vault on Solana where:
- **Users** deposit underlying tokens and receive vault shares
- **A manager** can withdraw underlying tokens (take float) to deploy capital off-vault
- **Users** withdraw via an async queue — requests are filled when liquidity is available
- The vault tracks `total_assets = vault_balance + float_outstanding` at all times

### Instructions

#### 1. `initialize_vault`
- Creates vault state account (PDA)
- Creates vault token account (PDA-owned ATA for underlying mint)
- Creates share mint (PDA as mint authority)
- Params: `manager`, `underlying_mint`, `max_float_bps` (cap on deployable float, e.g., 8000 = 80%)

#### 2. `deposit`
- User transfers underlying tokens to vault
- Vault mints shares to user
- Share calculation: `shares_out = deposit_amount * total_supply / total_assets`
- First depositor: define your strategy (see Design Decisions)
- Rounding: round DOWN (user gets fewer shares) — match ERC-4626 convention

#### 3. `request_withdraw`
- User specifies number of shares to redeem
- Creates a **withdraw ticket** account (PDA, seeded by vault + user + index or nonce)
- Shares are moved to escrow or burned — your choice, justify it
- Ticket stores: `user`, `shares`, `requested_slot`, `status: pending`
- Users can have multiple pending tickets

#### 4. `process_withdraw`
- Callable by **anyone** (cranker, manager, user)
- Checks if vault has enough liquidity to fill the ticket
- Calculates `amount_out = ticket.shares * total_assets / total_shares` at **processing time**
- If sufficient liquidity: transfers underlying to user, closes ticket (reclaims rent)
- If insufficient: fails, ticket remains pending
- Rounding: round DOWN (user gets less underlying) — match ERC-4626 convention

#### 5. `cancel_withdraw` (optional — your design decision)
- User cancels pending ticket, gets shares back
- Only valid if you escrowed shares (not burned)

#### 6. `manager_withdraw` (take float)
- Manager pulls underlying tokens to a specified receiver account
- Increments `float_outstanding` on vault state
- Enforces: `float_outstanding + amount <= total_assets * max_float_bps / 10000`
- Only callable by `manager` authority

#### 7. `manager_deposit` (return float)
- Returns underlying tokens to vault
- Decrements `float_outstanding`
- Permissionless — anyone can return capital to the vault

#### 8. `update_manager`
- Transfers manager authority
- Implement as single-step or two-step (nominate + accept) — justify your choice

---

### Vault State

Design the account layout yourself. Minimum fields:

| Field | Type | Purpose |
|---|---|---|
| `manager` | `Pubkey` | Current manager authority |
| `underlying_mint` | `Pubkey` | Token the vault holds |
| `share_mint` | `Pubkey` | Mint for vault shares |
| `vault_token_account` | `Pubkey` | Where underlying sits |
| `float_outstanding` | `u64` | How much the manager has deployed |
| `max_float_bps` | `u16` | Cap on float as % of total_assets |
| `total_tickets` | `u64` | Ticket counter / nonce for PDA derivation |
| `bump` | `u8` | PDA bump seed |

### Withdraw Ticket State

| Field | Type | Purpose |
|---|---|---|
| `vault` | `Pubkey` | Which vault this ticket belongs to |
| `user` | `Pubkey` | Who requested the withdrawal |
| `shares` | `u64` | Shares to redeem |
| `requested_slot` | `u64` | When the request was made |
| `bump` | `u8` | PDA bump |

---

## Design Decisions (Document These)

You must make and defend a choice for each. Write your reasoning — not just the answer.

1. **First depositor problem** — When `total_shares == 0`, what is the initial share price? How do you prevent a donation attack where an attacker inflates share price before the first real deposit? (Hint: look at how ERC-4626 implementations handle this — virtual shares/assets, dead shares, minimum deposit.)

2. **Share price timing** — Share price at `request_withdraw` vs `process_withdraw` can differ. Is this fair? What if the manager generates profit between request and processing — does the withdrawer benefit? Should they? How does ERC-7540 handle this?

3. **Burn vs escrow on request** — Do you burn shares when the user requests withdrawal, or escrow them until processing? Each has implications for share price calculation and cancellation. Which did you pick and why?

4. **Queue ordering** — Is the queue FIFO? Can a smaller later ticket get processed before a larger earlier one if liquidity is tight? What's the fairness tradeoff?

5. **Float cap under stress** — If users withdraw and TVL drops, `float_outstanding` might exceed `max_float_bps * total_assets`. What do you do? Block new float? Block user deposits? Nothing? This is a real edge case in managed vault designs.

6. **Permissionless return validation** — Anyone can call `manager_deposit`. What do you validate to prevent griefing (wrong token, dust amounts, state corruption)?

7. **Rounding direction** — ERC-4626 is explicit: round against the user (down on deposit shares, down on withdraw assets). Where in your Solana implementation does this apply? Where could rounding leak value over many transactions?

8. **Ticket spam** — Can someone create thousands of 1-lamport withdraw tickets to bloat on-chain state? How do you prevent it? (Rent is a natural deterrent on Solana — is it enough?)

---

## Constraints

- **Use Anchor** — implement the program with idiomatic `#[program]` instructions, `#[derive(Accounts)]` account validation, PDA seed/bump constraints, and explicit `#[error_code]` errors
- Do **not** use Pinocchio for this task
- CPI only to Token Program via `anchor_spl` (pick SPL Token or Token-2022, commit to one)
- All math in `u64` / `u128` — no floats, no external math libraries
- Every instruction must emit Anchor events/logs sufficient for an indexer to reconstruct vault state
- No `unwrap()` in the program — all errors explicit and meaningful

---

## Test Plan

Use Anchor's test workflow (`anchor test`) with TypeScript tests. Bankrun or `solana-program-test` can be used if you want faster or lower-level test execution. Required scenarios:

### Core Lifecycle
- [ ] Init → deposit → request_withdraw → process_withdraw (full happy path)
- [ ] Multiple users deposit → interleaved withdrawals → verify proportional claims

### Share Math
- [ ] First depositor gets correct shares (no inflation attack)
- [ ] Deposit 1 lamport, request withdraw 1 share — no value leak from rounding
- [ ] Large deposits + withdrawals — verify total_assets invariant holds

### Manager Float
- [ ] Manager withdraws float → verify `float_outstanding` incremented
- [ ] Manager withdraws up to cap → succeeds; over cap → fails
- [ ] Manager returns float → `float_outstanding` decremented
- [ ] Manager takes float → user requests withdraw → insufficient liquidity → manager returns → process succeeds

### Queue Behavior
- [ ] Multiple pending tickets → process in correct order
- [ ] Ticket stays pending when liquidity insufficient → succeeds later
- [ ] Share price changes between request and processing — user gets processing-time price
- [ ] Cancel ticket (if implemented) — shares returned correctly

### Edge Cases
- [ ] Float cap stress: users withdraw → TVL drops → float exceeds cap → verify behavior
- [ ] Permissionless return: non-manager deposits underlying → float_outstanding decrements correctly
- [ ] Wrong token in manager_deposit → rejected
- [ ] Zero-amount deposit / withdraw → handled gracefully
- [ ] Unauthorized manager_withdraw → rejected

---

## Deliverables

1. **ERC comparison doc** (before coding) — 1 page mapping ERC-4626/7540 to Solana
2. **Program source** — compiles with `anchor build`, deploys to localnet
3. **Test suite** — all scenarios above passing
4. **Design doc** — covers all 8 design decisions with reasoning
5. **Cross-review** — each intern reviews the other's code and design doc before submission

---

## Stretch Goals

- **Performance fee**: Manager takes X bps of profit when returning float above principal. How do you calculate "profit" in share terms?
- **Timelock on manager withdrawals**: Delay between request and execution. Adds another state machine.
- **Emergency shutdown**: Separate admin authority can freeze vault + force-recall float.
- **ERC-7540 operator pattern**: Allow a third party (cranker) to request withdrawals on behalf of users with approval.

---

## What "Done" Looks Like

- All tests pass on localnet
- A second person can read the code and understand the share math without verbal explanation
- Design doc answers all 8 questions with reasoning, not just choices
- ERC comparison doc demonstrates understanding of why these standards exist, not just what they specify
- No silent precision loss — every rounding decision is intentional and documented
