# Backend Manual Testing

This file is the stable entrypoint for backend manual testing documentation.

The detailed runbooks now live under [testing/](testing/):

| File | Purpose |
| --- | --- |
| [testing/README.md](testing/README.md) | Testing documentation map, common prerequisites, environment variables, local output files, and current coverage. |
| [testing/backend-user-flow-testing.md](testing/backend-user-flow-testing.md) | Local user flow: fixture setup, deposit, request withdraw, cancel withdraw, process withdraw. |
| [testing/backend-module-testing.md](testing/backend-module-testing.md) | Local mock module flow: register, sync NAV, deploy, recall. |
| [testing/backend-kamino-surfpool-testing.md](testing/backend-kamino-surfpool-testing.md) | Kamino USDC flow on Surfpool with cloned Klend accounts. |
| [testing/backend-transaction-build-reference.md](testing/backend-transaction-build-reference.md) | Saved transaction build schema, `jq` inspection commands, blockhash expiry, and script coverage notes. |

The backend builds unsigned Solana `VersionedTransaction` payloads. The local
testing strategy remains modular:

1. Use `setup_backend_fixture.ts` to prepare state and write a fixture JSON file.
2. Use one `inspect_*_transaction.js` script per backend endpoint.
3. Use `sign_backend_transaction.js` separately to review, validate, optionally
   sign, simulate, send, and confirm a saved transaction build.

Keep this top-level file short so existing links continue to work while the
actual runbooks stay easier to scan.
