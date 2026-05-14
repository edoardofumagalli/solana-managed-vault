# ERC-7540 Operator Pattern Design

## Goal

Allow a third party operator, such as a cranker or automation service, to request withdrawals on behalf of a user.

The operator pattern should preserve user custody. An operator can help submit transactions, but it must not gain arbitrary power over a user's vault shares.

## Design Summary

Add an explicit vault-level operator approval account.

A withdrawal request can be created by either:

1. the share owner directly; or
2. an approved operator acting on behalf of the share owner.

Important Solana-specific point: a program-level operator approval is not enough to move SPL tokens from the user's share token account. The SPL Token program also needs the caller to be authorized as either the token account owner or a token delegate.

Therefore the operator path requires two approvals:

- vault approval: the owner approves the operator inside this program;
- SPL Token delegate approval: the owner delegates enough share tokens to the operator on the user's share token account.

This keeps the vault authorization model aligned with Solana token ownership rules.

## Non-Goals

This design does not let an operator process withdrawals differently from the existing permissionless `process_withdraw` flow.

This design does not let an operator claim assets to a destination different from the user's withdrawal destination.

This design does not implement ERC-7540's full pending/claimable request accounting. It only adds the operator authorization pattern around `request_withdraw`.

This design does not automatically create or revoke SPL Token delegate approvals. The user must do that through the token program or client helper.

## New Account: `OperatorApproval`

Create a new state account:

```rust
#[account]
#[derive(InitSpace)]
pub struct OperatorApproval {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub bump: u8,
}
```

Suggested PDA seeds:

```rust
[
    OPERATOR_APPROVAL_SEED,
    vault.key().as_ref(),
    owner.key().as_ref(),
    operator.key().as_ref(),
]
```

The account existence means the operator is approved. No `approved: bool` field is needed in v1. Revocation closes the account.

Suggested constant:

```rust
pub const OPERATOR_APPROVAL_SEED: &[u8] = b"operator_approval";
```

## Instruction 1: `approve_operator`

Creates an operator approval for one owner, one operator, and one vault.

Accounts:

- `owner`: signer, the user granting approval
- `vault`: vault account
- `operator`: unchecked account or system account; does not need to sign
- `operator_approval`: init PDA
- `system_program`

Validation:

1. `operator != Pubkey::default()`
2. `operator != owner`
3. approval PDA seeds match `vault`, `owner`, and `operator`

Behavior:

1. Initialize `OperatorApproval` with `vault`, `owner`, `operator`, and bump.
2. Emit `OperatorApprovedEvent`.

The operator does not need to sign because the user is the one granting permission.

## Instruction 2: `revoke_operator`

Revokes a previously granted operator approval.

Accounts:

- `owner`: signer, must match `operator_approval.owner`
- `vault`: vault account
- `operator`: the operator being revoked
- `operator_approval`: mutable PDA, closed to owner

Validation:

1. `owner` matches `operator_approval.owner`
2. `vault` matches `operator_approval.vault`
3. `operator` matches `operator_approval.operator`

Behavior:

1. Close the `OperatorApproval` account.
2. Emit `OperatorRevokedEvent`.

Revoking the program approval does not automatically revoke the SPL Token delegate. The client should also revoke or reduce the SPL delegate allowance when the user wants to fully remove token-level authority.

## Update To `request_withdraw`

Today `request_withdraw` assumes:

```rust
pub user: Signer<'info>
```

and the share transfer uses `user` as the token authority.

For operator support, split the concepts:

```rust
pub owner: AccountInfo<'info>,
pub caller: Signer<'info>,
```

Meaning:

- `owner`: the user who owns the shares and receives the withdrawal ticket;
- `caller`: the transaction signer creating the request;
- if `caller == owner`, this is the normal direct-user path;
- if `caller != owner`, this is the operator path and requires `OperatorApproval`.

The user share token account should still be constrained to the owner:

```rust
token::authority = owner
```

The CPI transfer authority should become the caller:

```rust
authority: self.caller.to_account_info()
```

This works in the direct-user path because caller is the owner. It works in the operator path only if caller is also configured as SPL Token delegate for the user's share token account.

## Operator Authorization Checks

In `request_withdraw`, use this rule:

```text
if caller == owner:
    no operator approval required
else:
    require OperatorApproval(vault, owner, caller)
    require user_share_token_account.delegate == caller
    require delegated_amount >= shares_amount
```

The first check is program-level approval. The second and third checks ensure the token movement will be authorized by the SPL Token program and that we fail with a clear vault error before the CPI fails with a lower-level token error.

## PDA Derivations Affected

Withdrawal ticket seeds should continue to use the owner, not the caller:

```rust
[
    WITHDRAW_TICKET_SEED,
    vault.key().as_ref(),
    owner.key().as_ref(),
    vault.total_tickets.to_le_bytes().as_ref(),
]
```

User position seeds should also continue to use the owner:

```rust
[
    USER_VAULT_POSITION_SEED,
    vault.key().as_ref(),
    owner.key().as_ref(),
]
```

Reason: the pending request belongs to the user, even if an operator submitted the transaction.

## Events

Add events:

```rust
#[event]
pub struct OperatorApprovedEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
}

#[event]
pub struct OperatorRevokedEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
}
```

Extend `WithdrawRequestedEvent` with a caller field:

```rust
pub caller: Pubkey,
```

This lets an indexer distinguish direct user requests from operator-submitted requests.

## Errors

Potential new errors:

```rust
InvalidOperator
UnauthorizedOperator
InvalidTokenDelegate
InsufficientDelegatedShares
```

Suggested meaning:

- `InvalidOperator`: operator is invalid, such as default pubkey or same as owner.
- `UnauthorizedOperator`: caller is not the owner and does not have a matching `OperatorApproval`.
- `InvalidTokenDelegate`: caller is approved by the vault but is not the SPL Token delegate for the share account.
- `InsufficientDelegatedShares`: SPL Token delegate allowance is lower than `shares_amount`.

## Security Considerations

The operator must never be able to redirect assets to itself. The withdraw ticket should still store the owner as the withdrawal user, and `process_withdraw` should still transfer underlying to the owner's underlying token account passed there.

Program approval and SPL Token delegate approval are intentionally separate. Program approval controls vault intent; SPL delegate approval controls token movement.

Revoking only the program approval prevents future operator-created requests through this program, but any remaining SPL delegate allowance may still let the operator move tokens through the token program directly. Client UX should make this explicit.

The operator should pay transaction fees for operator-submitted requests. This means `caller` should be the payer for new accounts when `caller != owner`.

Direct user requests must keep working without requiring an `OperatorApproval` account.

## Test Plan

Add tests for:

1. Owner can approve an operator.
2. Owner can revoke an operator.
3. Non-owner cannot revoke someone else's operator approval.
4. Direct owner `request_withdraw` still works.
5. Approved operator with sufficient SPL Token delegate allowance can create a withdraw request for the owner.
6. Operator approval without SPL Token delegate fails.
7. SPL Token delegate without `OperatorApproval` fails.
8. Operator with insufficient delegated shares fails.
9. Revoked operator can no longer create requests.
10. Operator-created ticket stores owner as `ticket.user`, not operator.
11. Operator-created request increments the owner's `UserVaultPosition`, not the operator's.

## Implementation Order

1. Add `OPERATOR_APPROVAL_SEED` constant.
2. Add `OperatorApproval` state and export it from `state/mod.rs`.
3. Add `approve_operator` instruction.
4. Add `revoke_operator` instruction.
5. Add events and errors.
6. Add PDA helper in tests.
7. Add tests for approve/revoke only.
8. Refactor `request_withdraw` from `user` to `owner` + `caller`.
9. Add SPL Token delegate helper in tests.
10. Add operator request tests.
11. Update docs/playground only if we want a manual operator demo.
