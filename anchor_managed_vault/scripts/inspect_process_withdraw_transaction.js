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
      "ticket-index": "ticketIndex",
      "fee-payer": "feePayer",
      ...COMPUTE_BUDGET_INSPECT_OPTIONS,
    },
    required: ["vault", "user", "ticketIndex", "feePayer"],
  });
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:process-withdraw:inspect -- \\
    --vault <vault_pubkey> \\
    --user <withdraw_user_pubkey> \\
    --ticket-index <ticket_index> \\
    --fee-payer <fee_payer_pubkey> \\
    [--simulate] \\
${COMPUTE_BUDGET_USAGE}
    [--output .tmp/process-withdraw-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  const requestBody = {
    vault: args.vault,
    user: args.user,
    ticketIndex: args.ticketIndex,
    feePayer: args.feePayer,
    simulate: args.simulate,
  };
  const computeBudget = buildComputeBudgetRequest(args);

  if (computeBudget) {
    requestBody.computeBudget = computeBudget;
  }

  return requestBody;
}

inspectBackendTransaction({
  endpointPath: "/transactions/process-withdraw",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(error, printUsage);
});
