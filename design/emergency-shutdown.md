# Emergency Shutdown Design

## Goal

Add an emergency mode that lets the vault stop taking on new risk while still preserving user exits as much as possible.

The shutdown mechanism is meant for situations where continuing normal operations would be unsafe, for example a suspected manager compromise, an accounting bug, or an external strategy issue.

## Design Summary

The vault gets an emergency flag controlled by a dedicated emergency admin.

When emergency mode is active:

- new deposits are blocked;
- manager withdrawals are blocked;
- manager deposits remain allowed, so assets can be returned to the vault;
- user withdrawal requests remain allowed;
- withdrawal processing remains allowed when the vault has enough liquidity;
- withdrawal cancellation remains allowed.

The key idea is that shutdown should stop new exposure, not trap users unnecessarily.

## State Changes

Add these fields to `Vault`:

```rust
pub emergency_admin: Pubkey,
pub is_shutdown: bool,
pub shutdown_slot: u64,
```

Field meaning:

- `emergency_admin`: authority allowed to activate emergency shutdown.
- `is_shutdown`: true once emergency mode has been activated.
- `shutdown_slot`: slot at which shutdown was activated. This is useful for logs, tests, indexing, and debugging.

Important account-size note: adding fields to `Vault` changes the account size. For this exercise and fresh local/devnet deployments this is fine. For an already deployed production program with existing vault accounts, this would require a migration or account reallocation strategy.

## Initialization

`initialize_vault` should set the emergency admin.

Preferred design:

```rust
initialize_vault(max_float_bps, emergency_admin)
```

Validation:

- `emergency_admin != Pubkey::default()`
- `is_shutdown = false`
- `shutdown_slot = 0`

Keeping `emergency_admin` explicit is better than silently using the manager, because the emergency role is conceptually different from the manager role. The manager operates the vault; the emergency admin can freeze risky operations.

## New Instruction

### `activate_emergency_shutdown`

Activates emergency mode for a vault.

Accounts:

- `emergency_admin`: signer, must match `vault.emergency_admin`
- `vault`: mutable vault account
- optionally `vault_token_account`: useful if the emitted event should include the vault token balance

Behavior:

1. Verify the signer is the configured emergency admin.
2. Verify the vault is not already shut down.
3. Set `vault.is_shutdown = true`.
4. Set `vault.shutdown_slot = Clock::get()?.slot`.
5. Emit an emergency shutdown event.

This instruction should be irreversible in the first version. A separate `resume_vault` can be considered later, but it introduces a stronger governance/security requirement.

## Instruction Behavior In Shutdown Mode

| Instruction | Behavior when shut down | Reason |
| --- | --- | --- |
| `deposit` | Blocked | Prevents new users from entering a vault in emergency mode. |
| `manager_withdraw` | Blocked | Prevents more assets from leaving the vault into manager-controlled float. |
| `manager_deposit` | Allowed | Lets anyone return assets and reduce outstanding float. |
| `request_withdraw` | Allowed | Users should still be able to ask to exit. |
| `process_withdraw` | Allowed if liquid | Users should still receive assets when liquidity is available. |
| `cancel_withdraw` | Allowed | Users should be able to undo a pending request. |
| manager update instructions | Open decision | Could remain allowed, but freezing manager changes may be simpler for v1. |

## Errors

Potential new errors:

```rust
UnauthorizedEmergencyAdmin
ShutdownAlreadyActive
VaultShutdown
InvalidEmergencyAdmin
```

Suggested meaning:

- `UnauthorizedEmergencyAdmin`: signer is not `vault.emergency_admin`.
- `ShutdownAlreadyActive`: shutdown was already activated.
- `VaultShutdown`: instruction is blocked because the vault is shut down.
- `InvalidEmergencyAdmin`: emergency admin is the default pubkey or otherwise invalid.

## Events

Add an event for the shutdown activation:

```rust
#[event]
pub struct EmergencyShutdownActivated {
    pub vault: Pubkey,
    pub emergency_admin: Pubkey,
    pub shutdown_slot: u64,
    pub float_outstanding: u64,
}
```

Optional fields if useful for indexing/debugging:

```rust
pub vault_underlying_balance: u64,
pub total_assets: u64,
```

Including balances makes the event more informative, but it requires passing the token account needed to compute those values.

## Security Considerations

The emergency admin should be separate from the manager if possible. If the manager is compromised, a separate emergency admin gives the system a way to stop further manager withdrawals.

Shutdown should not block exits. Blocking both deposits and withdrawals would protect the vault mechanically, but it would create a bad user outcome by trapping users.

Shutdown does not automatically recover assets that are already outside the vault as float. The design relies on `manager_deposit` remaining open so capital can be returned.

The first version should avoid `resume_vault`. Reopening the vault after an incident requires more careful governance and operational assumptions.

## Test Plan

Add tests for:

1. `initialize_vault` stores `emergency_admin`, `is_shutdown = false`, and `shutdown_slot = 0`.
2. Emergency admin can activate shutdown.
3. Non-admin cannot activate shutdown.
4. Shutdown cannot be activated twice.
5. `deposit` fails after shutdown.
6. `manager_withdraw` fails after shutdown.
7. `manager_deposit` still works after shutdown.
8. `request_withdraw` still works after shutdown.
9. `process_withdraw` still works after shutdown when the vault has enough liquidity.
10. `cancel_withdraw` still works after shutdown.
11. Shutdown event is emitted with the expected fields.

## Implementation Order

1. Add new vault fields and update account space.
2. Update `initialize_vault` and its tests.
3. Add new errors.
4. Add `activate_emergency_shutdown` instruction.
5. Add shutdown guards to `deposit` and `manager_withdraw`.
6. Add event emission.
7. Add tests for the shutdown flow.
8. Update playground only if we want a manual emergency-mode demo.
