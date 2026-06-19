# Solana Managed Vault

This repository contains an Anchor managed vault and a Rust backend that builds
unsigned Solana transactions for the vault.

The vault is inspired by ERC-4626 share accounting and ERC-7540 asynchronous
redemptions. It supports user deposits, share issuance, async withdraw tickets,
manager float, module-based yield routing, a mock yield harness, and a Kamino
adapter prototype.

## Current Documentation

Use these files as the current source of truth:

| Path | Purpose |
| --- | --- |
| `design/managed-vault-design.md` | Canonical on-chain vault design. |
| `design/backend-api-design.md` | Backend transaction-building API contract. |
| `design/backend-roadmap.md` | Practical backend roadmap and Kamino account-routing plan. |
| `design/backend-manual-testing.md` | Manual backend testing entrypoint. Detailed runbooks live under `design/testing/`. |
| `design/testing/README.md` | Manual backend testing runbook index. |
| `design/project-cleanup-plan.md` | Repository inventory and cleanup operating plan. |
| `design/diagrams/*.puml` | Sequence diagrams for module deploy and recall flows. |

## Main Workspaces

| Path | Purpose |
| --- | --- |
| `anchor_managed_vault/` | Anchor workspace for the core vault, mock yield module, Kamino module, tests, scripts, and runbooks. |
| `backend/` | Rust/Axum backend that builds unsigned `VersionedTransaction` responses. |

## Historical Documents

Historical planning and exercise documents live under `design/archive/`.

They are useful context, but they are not the current implementation guide. When
there is a conflict, prefer the current documentation listed above.

## Cleanup Policy

The project cleanup is tracked in `design/project-cleanup-plan.md`.

Keep cleanup changes small and themed:

1. Documentation organization.
2. Generated local artifact cleanup.
3. Script maintainability.
4. Test documentation.
5. Backend refactors.

Do not delete files until the cleanup plan marks them as safe to remove.
