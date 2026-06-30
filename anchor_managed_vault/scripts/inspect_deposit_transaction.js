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
      amount: "amount",
      ...COMPUTE_BUDGET_INSPECT_OPTIONS,
    },
    required: ["vault", "user", "amount"],
  });
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:deposit:inspect -- \\
    --vault <vault_pubkey> \\
    --user <user_pubkey> \\
    --amount <base_units> \\
    [--simulate] \\
${COMPUTE_BUDGET_USAGE}
    [--output .tmp/deposit-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  const requestBody = {
    vault: args.vault,
    user: args.user,
    amount: args.amount,
    simulate: args.simulate,
  };
  const computeBudget = buildComputeBudgetRequest(args);

  if (computeBudget) {
    requestBody.computeBudget = computeBudget;
  }

  return requestBody;
}

inspectBackendTransaction({
  endpointPath: "/transactions/deposit",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(error, printUsage);
});
