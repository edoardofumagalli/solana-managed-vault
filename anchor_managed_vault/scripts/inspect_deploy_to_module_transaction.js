const {
  DEFAULT_FIXTURE_MODULE,
  handleInspectError,
  inspectBackendTransaction,
  loadFixtureRequest,
  parseInspectArgs,
  requireRequestFields,
  resolveRemainingAccounts,
} = require("./lib/backend_inspect");

function parseArgs(argv) {
  return parseInspectArgs(argv, {
    defaults: {
      fixtureModule: DEFAULT_FIXTURE_MODULE,
    },
    flags: ["simulate"],
    options: {
      fixture: "fixture",
      "fixture-module": "fixtureModule",
      vault: "vault",
      manager: "manager",
      "module-entry": "moduleEntry",
      amount: "amount",
      "remaining-accounts-file": "remainingAccountsFile",
      "remaining-accounts-json": "remainingAccountsJson",
    },
  });
}

function printUsage() {
  console.log(`
Usage with fixture:
  npm run backend:modules:deploy:inspect -- \\
    --fixture .tmp/backend-fixture.json \\
    [--fixture-module mockYield] \\
    [--amount 250000] \\
    [--simulate] \\
    [--output .tmp/deploy-to-module-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Usage with explicit accounts:
  npm run backend:modules:deploy:inspect -- \\
    --vault <vault_pubkey> \\
    --manager <manager_pubkey> \\
    --module-entry <module_entry_pubkey> \\
    --amount <raw_underlying_amount> \\
    --remaining-accounts-file .tmp/mock-deploy-remaining-accounts.json \\
    [--remaining-accounts-json '<json_array_or_object>'] \\
    [--simulate] \\
    [--output .tmp/deploy-to-module-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  const fixtureRequest = loadFixtureRequest(args, "deploy");
  const requestBody = {
    vault: args.vault || fixtureRequest.vault,
    manager: args.manager || fixtureRequest.manager,
    moduleEntry: args.moduleEntry || fixtureRequest.moduleEntry,
    amount: args.amount || fixtureRequest.amount,
    remainingAccounts: resolveRemainingAccounts(args, fixtureRequest, "deploy"),
    simulate:
      args.simulate !== undefined
        ? args.simulate
        : fixtureRequest.simulate || false,
  };

  requireRequestFields(requestBody, [
    "vault",
    "manager",
    "moduleEntry",
    "amount",
    "remainingAccounts",
  ]);

  return requestBody;
}

inspectBackendTransaction({
  endpointPath: "/transactions/modules/deploy",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(
    error,
    printUsage,
    "Deploy to module transaction inspection failed:"
  );
});
