# Managed Vault Implementation Strategy

## Goal

Use this document as the execution plan for building the Anchor managed vault program. The design choices are already documented in `design-decisions.md`; this file focuses on implementation order and test strategy.

## 1. Freeze Practical Choices

- Use classic SPL Token through `anchor_spl` unless a specific Token-2022 feature becomes necessary.
- Use a two-step manager transfer:
  - `nominate_manager(new_manager)`
  - `accept_manager()`
- Keep the first implementation focused on the required vault lifecycle before attempting stretch goals.

## 2. Scaffold Anchor

Create the Anchor project and verify the empty program/test runner first.

```bash
NO_DNA=1 anchor build
NO_DNA=1 anchor test
```

Do not start with vault logic until the toolchain, IDL generation, and TypeScript tests are working.

## 3. Define State, Constants, And Errors

Define accounts first:

- `VaultState`
- `WithdrawTicket`
- user/vault tracking state if needed for `pending_ticket_count`

Define constants:

- `BPS_DENOMINATOR = 10_000`
- `VIRTUAL_ASSETS`
- `VIRTUAL_SHARES`
- `MAX_PENDING_TICKETS_PER_USER`

Define explicit errors:

- zero amount
- zero output
- overflow
- invalid mint
- invalid authority
- insufficient liquidity
- float cap exceeded
- invalid queue order
- too many pending tickets

## 4. Implement Math Helpers First

Write pure helper functions before instruction logic:

- `total_assets(vault_balance, float_outstanding)`
- `assets_to_shares_down(...)`
- `shares_to_assets_down(...)`
- `checked_float_cap(...)`

Rules:

- use `u128` for intermediate multiplication
- divide last
- cast back to `u64` safely
- reject zero input and zero output where required
- never use floats

## 5. Implement `initialize_vault`

Create:

- vault state PDA
- vault token account for the underlying mint
- share mint with vault PDA as mint authority

Tests:

- accounts are created correctly
- share mint authority is the expected PDA
- vault token account uses the correct mint
- invalid `max_float_bps` fails

## 6. Implement `deposit`

Flow:

- transfer underlying from user to vault token account
- calculate shares using virtual assets/shares
- mint shares to user
- emit deposit event

Tests:

- first depositor receives expected shares
- donation attack scenario is not profitable
- non-exact division rounds down
- zero amount fails
- nonzero deposit that would mint zero shares fails

## 7. Implement Withdrawal Queue

### `request_withdraw`

Flow:

- validate user share balance
- create withdraw ticket PDA
- move shares into escrow
- assign `ticket_index`
- increment pending ticket count
- emit request event

### `cancel_withdraw`

Flow:

- validate user owns the ticket
- return escrowed shares to user
- decrement pending ticket count
- close ticket/escrow accounts where possible
- emit cancel event

### `process_withdraw`

Flow:

- enforce FIFO ordering
- calculate assets at processing time
- verify idle vault liquidity
- transfer underlying to user
- burn escrowed shares
- advance queue pointer
- decrement pending ticket count
- close ticket/escrow accounts where possible
- emit processed event

Tests:

- request moves shares into escrow
- cancel returns shares
- happy path: deposit -> request -> process
- processing uses current share price
- insufficient liquidity leaves ticket pending
- later ticket cannot skip earlier ticket
- cancelling oldest ticket advances queue

## 8. Implement Manager Float Flow

### `manager_withdraw`

Flow:

- require manager signer
- enforce float cap using post-withdraw values
- transfer underlying from vault to receiver
- increment `float_outstanding`
- emit manager withdraw event

Tests:

- manager can withdraw within cap
- over-cap withdraw fails
- unauthorized caller fails
- receiver token account must use correct mint

### `manager_deposit`

Flow:

- permissionless caller
- require correct underlying mint
- require canonical vault token account destination
- transfer underlying into vault
- decrement `float_outstanding` by `min(amount, float_outstanding)`
- treat excess as vault donation/profit
- emit manager deposit event

Tests:

- non-manager can return capital
- wrong mint fails
- wrong destination fails
- zero amount fails
- excess return sets `float_outstanding` to zero

## 9. Implement Manager Update

Use two-step authority transfer:

- current manager nominates pending manager
- pending manager accepts

Tests:

- current manager can nominate
- unauthorized nomination fails
- only nominated manager can accept
- accepted manager becomes active authority

## 10. Add Events

Emit events for:

- vault initialization
- deposit
- withdraw requested
- withdraw cancelled
- withdraw processed
- manager withdraw
- manager deposit
- manager nomination
- manager accepted

Events should include enough data for an indexer to reconstruct vault state changes:

- vault
- user/manager/caller
- ticket
- assets
- shares
- float outstanding
- total assets where relevant
- ticket index where relevant

## 11. Test In Layers

Recommended order:

1. initialization tests
2. math and deposit tests
3. request/cancel withdraw tests
4. process withdraw happy path
5. FIFO and insufficient liquidity tests
6. manager withdraw/deposit tests
7. float cap stress tests
8. rounding and dust tests
9. unauthorized and wrong-account tests

Each instruction should have:

- one happy-path test
- one authorization or account-validation test
- one math or edge-case test

## 12. Final Verification

Before considering the exercise done:

```bash
NO_DNA=1 anchor build
NO_DNA=1 anchor test
```

Review:

- no `unwrap()` in program logic
- all math uses checked integer operations
- all account constraints are explicit
- all PDA seeds are documented by tests
- all design decisions are reflected in code
- events are emitted for indexer reconstruction
