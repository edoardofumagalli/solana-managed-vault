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
      manager: "manager",
      "module-program": "moduleProgram",
      "module-state": "moduleState",
      "module-underlying-token-account": "moduleUnderlyingTokenAccount",
      "policy-seed": "policySeed",
    },
  });
}

function printUsage() {
  console.log(`
Usage with fixture:
  npm run backend:modules:register:inspect -- \\
    --fixture .tmp/backend-fixture.json \\
    [--fixture-module mockYield] \\
    [--simulate] \\
    [--output .tmp/register-module-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Usage with explicit accounts:
  npm run backend:modules:register:inspect -- \\
    --vault <vault_pubkey> \\
    --manager <manager_pubkey> \\
    --module-program <module_program_pubkey> \\
    --module-state <module_state_pubkey> \\
    --module-underlying-token-account <module_token_account_pubkey> \\
    --policy-seed <u64_policy_seed> \\
    [--simulate] \\
    [--output .tmp/register-module-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  const fixtureRequest = loadFixtureRequest(args, "register");
  const requestBody = {
    vault: args.vault || fixtureRequest.vault,
    manager: args.manager || fixtureRequest.manager,
    moduleProgram: args.moduleProgram || fixtureRequest.moduleProgram,
    moduleState: args.moduleState || fixtureRequest.moduleState,
    moduleUnderlyingTokenAccount:
      args.moduleUnderlyingTokenAccount ||
      fixtureRequest.moduleUnderlyingTokenAccount,
    policySeed: args.policySeed || fixtureRequest.policySeed,
    simulate:
      args.simulate !== undefined
        ? args.simulate
        : fixtureRequest.simulate || false,
  };

  requireRequestFields(requestBody, [
    "vault",
    "manager",
    "moduleProgram",
    "moduleState",
    "moduleUnderlyingTokenAccount",
    "policySeed",
  ]);

  return requestBody;
}

inspectBackendTransaction({
  endpointPath: "/transactions/modules/register",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(
    error,
    printUsage,
    "Register module transaction inspection failed:"
  );
});
