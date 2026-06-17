const {
  DEFAULT_FIXTURE_MODULE,
  handleInspectError,
  inspectBackendTransaction,
  loadFixtureRequest,
  parseInspectArgs,
  requireRequestFields,
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
      "module-entry": "moduleEntry",
      "fee-payer": "feePayer",
    },
  });
}

function printUsage() {
  console.log(`
Usage with fixture:
  npm run backend:modules:sync-nav:inspect -- \\
    --fixture .tmp/backend-fixture.json \\
    [--fixture-module mockYield] \\
    [--simulate] \\
    [--output .tmp/sync-module-nav-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Usage with explicit accounts:
  npm run backend:modules:sync-nav:inspect -- \\
    --vault <vault_pubkey> \\
    --module-entry <module_entry_pubkey> \\
    --fee-payer <fee_payer_pubkey> \\
    [--simulate] \\
    [--output .tmp/sync-module-nav-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  const fixtureRequest = loadFixtureRequest(args, "syncNav");
  const requestBody = {
    vault: args.vault || fixtureRequest.vault,
    moduleEntry: args.moduleEntry || fixtureRequest.moduleEntry,
    feePayer: args.feePayer || fixtureRequest.feePayer,
    simulate:
      args.simulate !== undefined
        ? args.simulate
        : fixtureRequest.simulate || false,
  };

  requireRequestFields(requestBody, ["vault", "moduleEntry", "feePayer"]);

  return requestBody;
}

inspectBackendTransaction({
  endpointPath: "/transactions/modules/sync-nav",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(
    error,
    printUsage,
    "Sync module NAV transaction inspection failed:"
  );
});
