# Managed Vault Design Decisions

## 1. First Depositor Problem

Question: When `total_shares == 0`, what is the initial share price? How do you prevent a donation attack where an attacker inflates the share price before the first real deposit?

Decision: Use virtual assets and virtual shares to define the initial exchange rate, and reject deposits that would mint zero shares. The initial intended price is 1 underlying base unit = 1 share base unit when the vault has no real assets and no real shares.

Reasoning: A naive first-deposit rule such as `shares_out = deposit_amount` is easy to understand, but it does not fully address the ERC-4626 donation/inflation attack. An attacker could deposit a tiny amount, receive nearly all existing shares, then donate assets directly into the vault token account to make the next user's deposit mint very few shares.

Virtual liquidity prevents the first depositor from owning 100% of the effective vault. The conversion math should behave as if the vault always has a small amount of virtual assets and virtual shares:

```text
effective_assets = total_assets + VIRTUAL_ASSETS
effective_shares = total_share_supply + VIRTUAL_SHARES
shares_out = deposit_amount * effective_shares / effective_assets
```

If `VIRTUAL_ASSETS` and `VIRTUAL_SHARES` use the same base-unit scale, the empty-vault starting price is 1:1. After the vault has real deposits, the virtual values remain in the formula and make donation attacks less profitable because the attacker cannot own the virtual shares. Any direct donation increases `total_assets`, but part of that value is effectively captured by the virtual side of the formula instead of being fully recoverable by the attacker.

The program should also reject `shares_out == 0`. This prevents users from accidentally depositing assets and receiving no shares due to integer division. A minimum deposit can be added as a UX and anti-spam rule, but the hard safety check is that every successful deposit must mint at least one share.

Implementation impact: Implement share math through a helper that always uses checked `u128` arithmetic and includes `VIRTUAL_ASSETS` / `VIRTUAL_SHARES`. Do not use a separate special-case formula that gives the first depositor all economic ownership of the vault. Return explicit errors for overflow, division by zero, zero deposit amount, and zero-share output.

Tests to add:
- First deposit into an empty vault mints shares at the expected initial 1:1 price.
- A tiny first deposit followed by a direct donation does not allow the attacker to profit from the next user's deposit.
- A deposit that would round down to zero shares is rejected.
- A direct donation before the first real deposit does not cause division by zero or silent precision loss.

## 2. Share Price Timing

Question: Should the withdrawal share price be fixed at `request_withdraw` time or calculated at `process_withdraw` time? What happens if the manager generates profit or loss between request and processing?

Decision: Calculate the withdrawal price at `process_withdraw` time. The withdrawal ticket stores the number of shares requested, not a fixed asset amount or fixed exchange rate.

Reasoning: This matches the task specification, which says `amount_out = ticket.shares * total_assets / total_shares` at processing time. It also keeps pending withdrawers economically exposed to the vault until their request is processed.

If the manager returns profit between request and processing, the withdrawer benefits because their shares are converted using the higher `total_assets`. If the vault loses value before processing, the withdrawer also shares in that loss. This is fair if requesting withdrawal does not immediately remove the user from vault economics. The user has asked to redeem shares, but final settlement has not happened yet.

This behavior is close to the async vault idea in ERC-7540: a request can be pending before it becomes claimable, and the protocol must define what value is fixed at request time versus claim time. For this implementation, fixing only the share amount is simpler and avoids storing stale exchange rates or asset amounts that may no longer match the vault's real accounting.

Implementation impact: `WithdrawTicket` should store `shares`, `user`, `vault`, `requested_slot`, and bump, but should not store `amount_out` as an authoritative value. `process_withdraw` must read current `total_assets`, current share supply, and current vault liquidity, then compute the asset amount with checked math and round down. Events should include both the requested shares and the final processed asset amount so indexers can reconstruct the timing difference.

Tests to add:
- User requests withdrawal, manager returns profit before processing, and the user receives the processing-time higher asset amount.
- User requests withdrawal, vault value decreases before processing, and the user receives the processing-time lower asset amount.
- Ticket stores shares only and does not become invalid when share price changes.
- `process_withdraw` fails if current idle liquidity is insufficient, even if the processing-time asset amount is valid.

## 3. Burn vs Escrow On Request

Question: When a user requests withdrawal, should shares be burned immediately or moved into escrow until processing?

Decision: Escrow shares at `request_withdraw` time, then burn the escrowed shares during `process_withdraw` after calculating the final asset amount. Support `cancel_withdraw` while the ticket is still pending.

Reasoning: Escrow keeps the requested shares included in total share supply until the withdrawal is actually processed. This matters because the task calculates `amount_out` at processing time using:

```text
amount_out = ticket.shares * total_assets / total_shares
```

If shares were burned immediately at request time, `total_shares` would decrease before settlement. Unless the program added extra accounting for pending burned shares, the processing-time formula could overpay the ticket because the numerator would use the ticket's burned shares while the denominator would exclude them.

Escrow also gives cleaner user semantics. The user no longer controls or transfers those shares while the request is pending, so they cannot double-spend the claim. At the same time, cancellation remains possible: if the user cancels before processing, the program can transfer the escrowed shares back and close the ticket.

The tradeoff is extra account complexity. The program needs an escrow token account for the ticket or another program-controlled escrow mechanism. That extra state is worth it because it preserves correct share supply accounting and supports the optional cancellation path.

Implementation impact: `request_withdraw` should transfer shares from the user's share token account into a program-controlled escrow token account associated with the ticket. `WithdrawTicket` should store the requested share amount and enough information to validate the escrow account. `process_withdraw` should calculate `amount_out` using current total share supply while the shares are still escrowed, transfer underlying assets to the user, burn the escrowed shares, and close the ticket/escrow accounts where possible. `cancel_withdraw` should transfer escrowed shares back to the user and close the pending ticket.

Tests to add:
- `request_withdraw` moves shares out of the user's token account and into escrow.
- User cannot transfer or redeem escrowed shares outside the ticket flow.
- `process_withdraw` calculates assets while escrowed shares are still part of total supply, then burns them.
- `cancel_withdraw` returns escrowed shares to the user and closes the pending ticket.
- Immediate burn is not used, avoiding denominator distortion in the processing-time formula.

## 4. Queue Ordering

Question: Is the withdrawal queue strictly FIFO? Can a smaller later ticket be processed before a larger earlier ticket if liquidity is limited?

Decision: Use strict FIFO ordering. A later ticket cannot be processed before earlier pending tickets from the same vault, even if the later ticket is smaller and current liquidity could satisfy it.

Reasoning: Strict FIFO is the clearest fairness rule: users are served in the order they requested withdrawal. Allowing smaller later tickets to skip earlier larger tickets improves liquidity utilization, but it creates a fairness problem because large requests can be starved while later users exit first.

FIFO also makes the system easier to reason about for users, indexers, and tests. A pending request's position in the queue is determined by its ticket index, not by who calls `process_withdraw` or by tactical splitting of requests. Without FIFO, users may be incentivized to split withdrawals into many small tickets to increase the chance that at least some tickets are processed earlier.

The tradeoff is that available liquidity can sit unused if the oldest pending ticket is larger than the current vault liquidity. This is acceptable for the first implementation because it favors predictable fairness over throughput optimization. A future version could add pro-rata processing or partial fills, but that would require a more complex state machine.

Implementation impact: Store a monotonic `ticket_index` on each `WithdrawTicket` and track the next processable ticket index in vault state, for example `next_ticket_to_process`. `request_withdraw` increments `total_tickets` when creating a ticket. `process_withdraw` must reject any ticket whose index is not the current next pending index. When the current ticket is successfully processed or cancelled, advance the queue pointer.

Tests to add:
- Multiple tickets process successfully in ticket-index order.
- A later smaller ticket cannot be processed before an earlier larger pending ticket.
- If the first ticket has insufficient liquidity, later tickets also cannot be processed.
- Cancelling the oldest pending ticket advances the queue so the next ticket can be processed.

## 5. Float Cap Under Stress

Question: If withdrawals reduce TVL and `float_outstanding` becomes greater than `max_float_bps * total_assets`, what should the program do?

Decision: Do not block user exits or deposits. If the vault becomes over the float cap, block any new `manager_withdraw` until the vault returns within the cap. Continue allowing `manager_deposit` so anyone can return capital and reduce `float_outstanding`.

Reasoning: The float cap is a constraint on new manager risk, not a reason to trap users. If existing withdrawals reduce `total_assets`, the same `float_outstanding` can become too large relative to the smaller vault. Blocking `process_withdraw` would punish users for a manager-side liquidity problem, so withdrawals should remain allowed whenever there is enough idle liquidity to satisfy the ticket.

The program also should not force an automatic reduction of `float_outstanding`, because the assets are outside the vault and cannot be seized by the program. The only safe on-chain response is to stop the manager from taking additional float until the cap is healthy again.

Deposits should remain allowed because they increase `total_assets` and idle liquidity, which can help bring the vault back under the cap. `manager_deposit` should remain permissionless because returning capital is always helpful as long as the token and amount are valid.

This creates a clear stress policy: existing over-cap float is tolerated as a temporary state, user-facing operations continue where possible, and manager risk-taking is frozen until compliance is restored.

Implementation impact: `manager_withdraw` must enforce the cap using the post-withdraw values:

```text
new_float_outstanding = float_outstanding + amount
new_float_outstanding <= total_assets * max_float_bps / 10_000
```

If `float_outstanding` is already above the cap, any positive `manager_withdraw` must fail. `deposit`, `request_withdraw`, `process_withdraw`, `cancel_withdraw`, and `manager_deposit` should not fail only because the vault is temporarily over cap. Events should make over-cap situations observable by including `float_outstanding`, `total_assets`, and `max_float_bps` after manager operations and withdrawals.

Tests to add:
- Withdrawals reduce `total_assets` and make `float_outstanding` exceed the cap; the vault records the state without blocking the withdrawal.
- Any new `manager_withdraw` fails while the vault is over cap.
- User deposits remain allowed while the vault is over cap.
- `manager_deposit` remains allowed while over cap and can bring `float_outstanding` back within the cap.
- After enough capital is returned or deposited, `manager_withdraw` succeeds again only up to the cap.

## 6. Permissionless Return Validation

Question: Since anyone can call `manager_deposit`, what validations prevent wrong-token transfers, dust griefing, or state corruption?

Decision: Keep `manager_deposit` permissionless, but only accept positive returns of the vault's underlying mint into the canonical vault token account. Decrement `float_outstanding` by the smaller of `amount` and current `float_outstanding`, and treat any excess as a normal donation to the vault.

Reasoning: Permissionless capital return is useful because anyone can improve vault liquidity and reduce manager float risk. The caller should not need to be the manager if they are returning the correct asset to the correct vault.

The dangerous part is not who calls the instruction, but what accounts and amount are accepted. A wrong token must not be counted as returned float. A transfer into a random token account must not update vault state. A zero-amount call should not emit misleading state changes or waste compute. And `float_outstanding` must never underflow if someone returns more assets than the current outstanding float.

If the returned amount is greater than `float_outstanding`, the extra assets should stay in the vault token account as a donation/profit to the vault rather than making `float_outstanding` negative. This preserves accounting and increases `total_assets` for remaining shareholders.

Implementation impact: `manager_deposit` should validate that the destination token account is `vault_state.vault_token_account`, that its mint is `vault_state.underlying_mint`, and that the token program matches the chosen token program. The source token account must also use the same underlying mint. Require `amount > 0`.

After the SPL transfer succeeds, update:

```text
returned_float = min(amount, float_outstanding)
float_outstanding = float_outstanding - returned_float
```

The event should include `amount_transferred`, `returned_float`, `excess_amount`, and the new `float_outstanding`, so an indexer can distinguish actual float repayment from extra donation/profit.

Tests to add:
- A non-manager can return underlying tokens and reduce `float_outstanding`.
- Returning the wrong mint is rejected.
- Returning to the wrong destination token account is rejected.
- Returning zero amount is rejected.
- Returning more than `float_outstanding` sets `float_outstanding` to zero and leaves the excess as vault assets.

## 7. Rounding Direction

Question: Where does ERC-4626-style rounding against the user apply in this Solana implementation? Where could rounding dust accumulate over time?

Decision: Round down in every asset/share conversion, matching ERC-4626. Deposits round down when minting shares, and withdrawals round down when paying underlying assets. Reject successful-looking operations that would round to zero output.

Reasoning: Integer division cannot represent fractional shares or fractional token base units. ERC-4626 resolves this by rounding against the user so the vault is not drained by repeated rounding in user-favorable directions.

For deposits, rounding down means the depositor receives fewer shares if the division is not exact:

```text
shares_out = assets_in * effective_total_shares / effective_total_assets
```

For withdrawals, rounding down means the withdrawer receives fewer underlying assets if the division is not exact:

```text
assets_out = shares_in * total_assets / total_share_supply
```

The leftover fractional value becomes rounding dust retained by the vault. Over many transactions, this dust slightly benefits remaining shareholders. That is acceptable because it is intentional, documented, and consistent with ERC-4626. The unacceptable case is silent user loss where a nonzero input produces zero output; those operations should fail explicitly.

Implementation impact: Put conversion math in shared helper functions such as `assets_to_shares_down` and `shares_to_assets_down`. Use checked `u128` multiplication, divide last, and safely cast back to `u64`. Return explicit errors for overflow, division by zero, zero input, and zero output.

Apply the same rounding policy in:
- `deposit` share mint calculation.
- `process_withdraw` asset payout calculation.
- client/test preview helpers.
- any future `maxRedeem` or `maxWithdraw` helper calculations.

Do not use floating point, and do not mix rounding directions across code paths.

Tests to add:
- Deposit with a non-exact division rounds down to fewer shares.
- Withdrawal with a non-exact division rounds down to fewer assets.
- Nonzero deposit that would mint zero shares is rejected.
- Nonzero withdrawal that would pay zero assets is rejected.
- Client/test preview math matches the program's on-chain rounding exactly.
- Repeated small deposits/withdrawals do not reduce `total_assets` through rounding leakage.

## 8. Ticket Spam

Question: Can someone create many tiny withdrawal tickets to bloat on-chain state? Is rent enough of a deterrent, or should the program add extra limits?

Decision: Use rent as the baseline deterrent, but also reject zero-output/dust tickets and cap the number of pending tickets per user per vault. Every processed or cancelled ticket should close its accounts and return rent to the payer/owner.

Reasoning: Solana rent makes ticket spam expensive because every `WithdrawTicket` and escrow account requires lamports. That is helpful, but it is not enough by itself: a determined attacker could still create many tiny tickets to increase indexer load, complicate FIFO processing, or clutter vault state.

The program should reject useless tickets at the source. A request for zero shares must fail, and a request that would clearly produce zero assets under current math should also fail. This prevents 1-lamport or 1-share tickets from becoming permanent low-value state when they cannot ever produce meaningful output.

A per-user pending ticket cap gives the protocol an additional hard bound while still allowing legitimate users to split withdrawals if needed. The cap should be small and explicit for the first implementation, such as `MAX_PENDING_TICKETS_PER_USER = 8`. This is easier to reason about than an unbounded queue and reduces accidental state growth.

Closing tickets after processing or cancellation is also important. The ticket exists only to preserve pending withdrawal state; once it is settled or cancelled, keeping it open wastes rent and makes indexing noisier.

Implementation impact: Track enough state to enforce the pending ticket cap. Options include storing a `pending_ticket_count` per user-vault position account, or deriving user tickets from a per-user nonce and maintaining a compact user withdrawal state account. If the implementation only has global `total_tickets`, add a small per-user state account before enforcing a per-user cap.

`request_withdraw` should require:
- `shares > 0`.
- the estimated current `assets_out > 0`.
- user's pending ticket count is below the configured cap.

`process_withdraw` and `cancel_withdraw` should decrement the pending count and close the ticket and escrow accounts. Events should include ticket creation and closure so indexers can track active state.

Tests to add:
- Zero-share withdrawal request is rejected.
- Dust request that would produce zero assets is rejected.
- Creating tickets up to the per-user cap succeeds.
- Creating one more ticket above the per-user cap fails.
- Processing a ticket closes its accounts and allows another ticket to be created.
- Cancelling a ticket closes its accounts and allows another ticket to be created.
