# Manager Withdraw Timelock Design

## Goal

Add a delay between a manager withdrawal request and the actual movement of underlying assets out of the vault.

The current `manager_withdraw` flow transfers assets immediately. A timelock makes the manager flow safer because users, the emergency admin, and off-chain monitoring have time to react before vault liquidity leaves.

## Design Summary

Replace the immediate manager withdrawal with a two-step flow:

1. `request_manager_withdraw(amount, receiver)`
2. `execute_manager_withdraw(request_id)` after the timelock has elapsed

The request records the intended withdrawal in a PDA. Execution later re-checks all safety conditions before transferring funds.

Important: the old immediate `manager_withdraw` path must not remain callable, otherwise the timelock can be bypassed.

## Non-Goals

This design does not add performance fees.

This design does not create a general governance system.

This design does not guarantee a wall-clock delay in seconds. It uses Solana slots, which are approximate time units.

## State Changes

Add these fields to `Vault`:

```rust
pub manager_withdraw_delay_slots: u64,
pub next_manager_withdraw_request_id: u64,
```

Field meaning:

- `manager_withdraw_delay_slots`: number of slots that must pass before a manager withdrawal request can be executed.
- `next_manager_withdraw_request_id`: counter used to derive unique request PDAs.

Initialization should either:

- receive `manager_withdraw_delay_slots` as an argument, or
- use a program constant such as `DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS`.

Preferred design: pass it as an explicit `initialize_vault` argument and validate it against a max allowed delay.

Suggested constants:

```rust
pub const MANAGER_WITHDRAW_REQUEST_SEED: &[u8] = b"manager_withdraw_request";
pub const MAX_MANAGER_WITHDRAW_DELAY_SLOTS: u64 = 432_000;
```

The max value is only a guardrail. The exact number can be adjusted. Around 432,000 slots is roughly two days if slots average around 400ms.

## New Account: `ManagerWithdrawRequest`

Create a new state account:

```rust
#[account]
#[derive(InitSpace)]
pub struct ManagerWithdrawRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub receiver_underlying_token_account: Pubkey,
    pub request_id: u64,
    pub amount: u64,
    pub requested_slot: u64,
    pub executable_after_slot: u64,
    pub bump: u8,
}
```

Suggested PDA seeds:

```rust
[
    MANAGER_WITHDRAW_REQUEST_SEED,
    vault.key().as_ref(),
    request_id.to_le_bytes().as_ref(),
]
```

The request stores the receiver token account chosen by the manager at request time. Execution must send funds only to that stored account. The underlying mint and vault token account are not stored in the request because `vault.underlying_mint` and `vault.vault_token_account` are the sources of truth.

## Instruction 1: `request_manager_withdraw`

Creates a pending manager withdrawal request.

Accounts:

- `manager`: signer, must match `vault.manager`
- `vault`: mutable
- `receiver_underlying_token_account`
- `manager_withdraw_request`: init PDA
- `system_program`

Validation:

1. `amount > 0`
2. `vault.is_shutdown == false`
3. signer is current `vault.manager`
4. receiver token account mint is `vault.underlying_mint`
5. current vault liquidity is enough for `amount`
6. current float cap would still be respected if this amount were withdrawn

Even though execution will re-check liquidity and cap later, checking them during request avoids creating obviously invalid requests.

Behavior:

1. Read current slot.
2. Use `vault.next_manager_withdraw_request_id` as `request_id`.
3. Set `executable_after_slot = current_slot + vault.manager_withdraw_delay_slots` with checked math.
4. Store request data in the request PDA.
5. Increment `vault.next_manager_withdraw_request_id`.
6. Emit `ManagerWithdrawRequestedEvent`.

## Instruction 2: `execute_manager_withdraw`

Executes a pending request after the delay.

Execution can be permissionless because the manager already authorized the withdrawal when creating the request. This also allows bots or keepers to execute ready requests.

Accounts:

- `executor`: signer, pays transaction fee only
- `vault`: mutable
- `manager_withdraw_request`: mutable, closed after execution
- `receiver_underlying_token_account`
- `token_program`

Validation:

1. `vault.is_shutdown == false`
2. current slot is `>= request.executable_after_slot`
3. request belongs to this vault
4. request manager still equals current `vault.manager`
5. passed `underlying_mint` matches `vault.underlying_mint`
6. request receiver matches passed `receiver_underlying_token_account`
7. passed `vault_token_account` matches `vault.vault_token_account`
8. vault has enough liquid assets now
9. post-withdraw `float_outstanding` still respects the cap now

Re-checking liquidity and cap at execution is essential because vault state can change between request and execution.

Behavior:

1. Transfer underlying from vault token account to stored receiver token account.
2. Increment `vault.float_outstanding` by request amount.
3. Close the request account.
4. Emit `ManagerWithdrawExecutedEvent`.

## Optional Instruction: `cancel_manager_withdraw_request`

Recommended, but can be implemented after request/execute.

Why useful:

- The manager may create a request and later change their mind.
- Emergency shutdown can make a pending request permanently unexecutable, so cancellation avoids leaving rent locked forever.

Simple v1 behavior:

- current manager can cancel a pending request;
- request account is closed;
- no token movement happens.

Possible v2 behavior:

- emergency admin can also cancel pending manager withdrawal requests.

## Emergency Shutdown Interaction

Emergency shutdown should block both request and execution:

- `request_manager_withdraw` fails if `vault.is_shutdown == true`.
- `execute_manager_withdraw` fails if `vault.is_shutdown == true`.

This is the main security benefit of combining timelock with emergency shutdown. If a suspicious manager withdrawal request appears, the emergency admin can activate shutdown before the request becomes executable.

Pending requests remain stored after shutdown. If cancellation is implemented, they can be cleaned up without moving funds.

## Manager Update Interaction

Preferred v1 rule: a pending manager withdrawal request is executable only if the request manager is still the current manager.

That means this check should pass at execution:

```rust
require_keys_eq!(
    request.manager,
    vault.manager,
    VaultError::UnauthorizedManager
);
```

Reason: if manager authority changes before execution, old manager requests should not retain withdrawal power.

## Events

Add events:

```rust
#[event]
pub struct ManagerWithdrawRequestedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub receiver_underlying_token_account: Pubkey,
    pub amount: u64,
    pub requested_slot: u64,
    pub executable_after_slot: u64,
}

#[event]
pub struct ManagerWithdrawExecutedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub executor: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub receiver_underlying_token_account: Pubkey,
    pub amount: u64,
    pub float_outstanding: u64,
    pub total_assets: u64,
}

#[event]
pub struct ManagerWithdrawRequestCancelledEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub amount: u64,
}
```

The cancel event is needed only if cancellation is implemented.

## Errors

Potential new errors:

```rust
InvalidManagerWithdrawDelay
ManagerWithdrawTimelockNotElapsed
InvalidManagerWithdrawRequest
```

Suggested meaning:

- `InvalidManagerWithdrawDelay`: delay exceeds the configured max.
- `ManagerWithdrawTimelockNotElapsed`: execution was attempted too early.
- `InvalidManagerWithdrawRequest`: request account does not match the expected vault/request data.

Existing errors can be reused for:

- zero amount: `InvalidAmount`
- unauthorized manager: `UnauthorizedManager`
- shutdown: `VaultShutdown`
- insufficient liquidity: `InsufficientLiquidity`
- cap exceeded: `FloatCapExceeded`
- math overflow: `MathOverflow`

## Test Plan

Add tests for:

1. `initialize_vault` stores `manager_withdraw_delay_slots` and initializes request counter to zero.
2. Manager can create a withdrawal request.
3. Non-manager cannot create a withdrawal request.
4. Zero amount request fails.
5. Request above current liquidity fails.
6. Request above current float cap fails.
7. Request stores receiver, amount, requested slot, and executable slot.
8. Execute before timelock fails.
9. Execute after timelock succeeds.
10. Execution transfers assets and increments `float_outstanding`.
11. Execution closes the request account.
12. Execution re-checks liquidity at execution time.
13. Execution re-checks float cap at execution time.
14. Emergency shutdown blocks new requests.
15. Emergency shutdown blocks execution of already pending requests.
16. Manager update invalidates old pending requests.
17. Cancel closes a pending request without moving funds, if cancellation is implemented.

## Implementation Order

1. Add constants.
2. Add `ManagerWithdrawRequest` state account.
3. Add vault fields for delay and request counter.
4. Update `initialize_vault` signature and tests.
5. Add request PDA helper in TypeScript tests.
6. Implement `request_manager_withdraw`.
7. Implement `execute_manager_withdraw`.
8. Remove the old immediate `manager_withdraw` path.
9. Add tests for request and execute.
10. Add cancellation as a follow-up if desired.

## Design Decision

The best first version is request + execute + no immediate withdrawal path.

Cancellation is useful, but it can be added immediately after the core two-step flow. The critical property is that assets cannot leave the vault until the delay has elapsed and all safety checks still pass.
