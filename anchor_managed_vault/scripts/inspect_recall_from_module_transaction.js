const {
  COMPUTE_BUDGET_INSPECT_OPTIONS,
  COMPUTE_BUDGET_USAGE,
  DEFAULT_FIXTURE_MODULE,
  buildComputeBudgetRequest,
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
      ...COMPUTE_BUDGET_INSPECT_OPTIONS,
    },
  });
}

function printUsage() {
  console.log(`
Usage with fixture:
  npm run backend:modules:recall:inspect -- \\
    --fixture .tmp/backend-fixture.json \\
    [--fixture-module mockYield] \\
    [--amount 100000] \\
    [--simulate] \\
${COMPUTE_BUDGET_USAGE}
    [--output .tmp/recall-from-module-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Usage with explicit accounts:
  npm run backend:modules:recall:inspect -- \\
    --vault <vault_pubkey> \\
    --manager <manager_pubkey> \\
    --module-entry <module_entry_pubkey> \\
    --amount <raw_underlying_amount> \\
    --remaining-accounts-file .tmp/mock-recall-remaining-accounts.json \\
    [--remaining-accounts-json '<json_array_or_object>'] \\
    [--simulate] \\
${COMPUTE_BUDGET_USAGE}
    [--output .tmp/recall-from-module-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  const fixtureRequest = loadFixtureRequest(args, "recall");
  const requestBody = {
    vault: args.vault || fixtureRequest.vault,
    manager: args.manager || fixtureRequest.manager,
    moduleEntry: args.moduleEntry || fixtureRequest.moduleEntry,
    amount: args.amount || fixtureRequest.amount,
    remainingAccounts: resolveRemainingAccounts(args, fixtureRequest, "recall"),
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

  const computeBudget =
    buildComputeBudgetRequest(args) || fixtureRequest.computeBudget;

  if (computeBudget) {
    requestBody.computeBudget = computeBudget;
  }

  return requestBody;
}

inspectBackendTransaction({
  endpointPath: "/transactions/modules/recall",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(
    error,
    printUsage,
    "Recall from module transaction inspection failed:"
  );
});
