# Float NAV Reporting Design

## Goal

Allow the manager to report the current value of capital held outside the vault.

Today `float_outstanding` is updated when the manager withdraws assets from the vault and when capital is returned through `manager_deposit`. This works if the off-vault position is assumed to keep the same value. It does not capture profit or loss while the capital is outside the vault.

This feature makes the off-vault value explicit: the manager can report that the external position is now worth more or less than the amount originally withdrawn.

## Design Summary

Keep the existing total assets formula:

```text
total_assets = vault_token_account.amount + float_outstanding
```

Change the interpretation of `float_outstanding`:

```text
Before: amount of principal currently owed by the manager
After: current reported value of the off-vault position
```

This means:

- if the manager withdraws 1,000, `float_outstanding` initially increases by 1,000;
- if the off-vault position grows to 1,200, the manager reports `float_outstanding = 1,200`;
- if the off-vault position falls to 600, the manager reports `float_outstanding = 600`.

Share math does not need a new formula. Existing deposits and withdrawals already use `total_assets`, so users naturally participate in both profit and loss through the share price.

## Non-Goals

This design does not add performance fees.

This design does not verify the reported value on-chain. The report is trusted because the current managed vault model already trusts the manager for off-chain capital.

This design does not integrate with Kamino or any on-chain strategy module. Module-based NAV reporting should be added later with a separate module system.

This design does not split principal and profit into separate state fields in v1.

## New Instruction: `report_float_value`

Updates the reported value of the off-vault position.

Suggested signature:

```rust
pub fn report_float_value(
    ctx: Context<ReportFloatValue>,
    reported_float_value: u64,
) -> Result<()>
```

Accounts:

- `manager`: signer, must match `vault.manager`
- `vault`: mutable vault state
- `underlying_mint`: used to derive and validate the vault PDA
- `vault_token_account`: canonical vault token account, used to compute total assets after the report

Validation:

1. `manager` must be the current `vault.manager`.
2. `vault` must match `[VAULT_SEED, underlying_mint]`.
3. `underlying_mint` must match `vault.underlying_mint`.
4. `vault_token_account` must match `vault.vault_token_account`.
5. `vault_token_account` must hold the vault underlying mint and be owned by the vault PDA.
6. The new value plus the vault token account balance must not overflow `u64`.

Decision: emergency shutdown does not block reporting.

V1 rule: allow reporting during shutdown. A report can lower or raise NAV, but it does not move funds out of the vault. During an incident, having the latest external position value is useful for users and indexers.

## Behavior

The instruction should:

1. Read the old `vault.float_outstanding`.
2. Set `vault.float_outstanding = reported_float_value`.
3. Compute `total_assets_after = vault_token_account.amount + reported_float_value`.
4. Emit `FloatValueReportedEvent`.

No token transfer happens.

## Event

Add an event:

```rust
#[event]
pub struct FloatValueReportedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub old_float_value: u64,
    pub new_float_value: u64,
    pub vault_underlying_balance: u64,
    pub total_assets: u64,
}
```

Profit or loss can be derived off-chain:

```text
delta = new_float_value - old_float_value
```

If `new > old`, the reported external position gained value. If `new < old`, the reported external position lost value.

## Interaction With Share Math

The existing share conversion helpers already use total assets.

Deposit:

```text
shares_out = assets_in * effective_total_shares / effective_total_assets
```

Withdrawal:

```text
assets_out = shares_in * effective_total_assets / effective_total_shares
```

Because `effective_total_assets` includes `float_outstanding`, reporting a higher external value increases share price and reporting a lower external value decreases share price.

Example profit:

```text
vault balance = 500
float_outstanding = 1,000
total_assets = 1,500

manager reports 1,200
new total_assets = 1,700
share price increases
```

Example loss:

```text
vault balance = 500
float_outstanding = 1,000
total_assets = 1,500

manager reports 600
new total_assets = 1,100
share price decreases
```

This is the intended share-based behavior: users are exposed proportionally to gains and losses of the managed capital until they exit.

## Interaction With Manager Withdraw And Deposit

`execute_manager_withdraw` should keep its existing behavior:

```text
float_outstanding += amount
```

The withdrawn amount becomes the initial reported external value.

`manager_deposit` should keep its existing behavior for now:

```text
returned_float = min(amount, float_outstanding)
float_outstanding -= returned_float
excess_amount stays in the vault as donated/profit assets
```

This means if the manager reports an off-vault value of 1,200 and later returns 1,200, the outstanding value goes to zero. If the manager returns more than the reported outstanding value, the excess remains in the vault token account and benefits shareholders.

## Float Cap Considerations

The float cap currently limits how much value can be outside the vault relative to total assets.

Reporting can move the vault above or below the cap without any token movement. This should not block the report itself, because the report is meant to reflect reality. However, if the report causes the vault to be above the cap, new manager withdrawal requests should continue to fail under the existing cap checks.

This keeps the stress behavior consistent:

- user exits are not blocked just because the vault is above cap;
- manager cannot take additional float while above cap;
- manager deposits can still return capital;
- reporting remains available so NAV can be accurate.

## Security Considerations

This is a trusted reporting mechanism. The manager can report an inaccurate value. That is acceptable for the current off-chain managed-float model because users already trust the manager to hold and return external capital.

The report must not transfer assets. It should only update accounting state.

The event is important. Off-chain monitoring should be able to see when the manager changes the reported external value and by how much.

A future on-chain module system should reduce trust by replacing manual reports with module-owned `cached_nav` accounts that are calculated from real protocol state.

## Future Module System Direction

This instruction is a bridge toward module-based NAV.

Current v1:

```text
total_assets = vault_balance + manually_reported_float
```

Future module design:

```text
total_assets = vault_balance + manual_float + sum(module.cached_nav)
```

Or, after full migration:

```text
total_assets = vault_balance + sum(module.cached_nav)
```

The week-4 prototype uses this pattern:

1. module calculates its own `cached_nav`;
2. vault syncs module NAV into a module entry;
3. vault aggregates idle balance plus module NAV.

For this branch, we should not implement modules yet. The goal is only to make the current off-vault float value reportable.

## Test Plan

Add tests for:

1. Manager can report a higher float value.
2. Manager can report a lower float value.
3. Unauthorized caller cannot report float value.
4. Reporting does not move tokens.
5. Reporting a higher value increases `total_assets` used by withdrawal processing.
6. Reporting a lower value decreases `total_assets` used by withdrawal processing.
7. Reporting remains allowed during emergency shutdown, if we keep the preferred v1 rule.
8. If reporting pushes the vault above the float cap, new manager withdrawal requests still fail.

## Implementation Order

1. Add `FloatValueReportedEvent`.
2. Add `report_float_value.rs` instruction.
3. Wire the instruction in `instructions/mod.rs` and `lib.rs`.
4. Add tests in a focused file such as `report_float_value.ts`.
5. Update playground only if we want a manual demo of profit/loss reporting.
