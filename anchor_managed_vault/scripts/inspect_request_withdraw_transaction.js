const {
  COMPUTE_BUDGET_INSPECT_OPTIONS,
  COMPUTE_BUDGET_USAGE,
  buildComputeBudgetRequest,
  handleInspectError,
  inspectBackendTransaction,
  parseInspectArgs,
} = require("./lib/backend_inspect");

function parseArgs(argv) {
  return parseInspectArgs(argv, {
    defaults: {
      simulate: false,
    },
    flags: ["simulate"],
    options: {
      vault: "vault",
      user: "user",
      "shares-amount": "sharesAmount",
      ...COMPUTE_BUDGET_INSPECT_OPTIONS,
    },
    required: ["vault", "user", "sharesAmount"],
  });
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:request-withdraw:inspect -- \\
    --vault <vault_pubkey> \\
    --user <user_pubkey> \\
    --shares-amount <share_base_units> \\
    [--simulate] \\
${COMPUTE_BUDGET_USAGE}
    [--output .tmp/request-withdraw-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  const requestBody = {
    vault: args.vault,
    user: args.user,
    sharesAmount: args.sharesAmount,
    simulate: args.simulate,
  };
  const computeBudget = buildComputeBudgetRequest(args);

  if (computeBudget) {
    requestBody.computeBudget = computeBudget;
  }

  return requestBody;
}

inspectBackendTransaction({
  endpointPath: "/transactions/request-withdraw",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(error, printUsage);
});
