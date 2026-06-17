const {
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
    },
    required: ["vault", "user", "ticketIndex"],
  });
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:cancel-withdraw:inspect -- \\
    --vault <vault_pubkey> \\
    --user <user_pubkey> \\
    --ticket-index <ticket_index> \\
    [--simulate] \\
    [--output .tmp/cancel-withdraw-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  return {
    vault: args.vault,
    user: args.user,
    ticketIndex: args.ticketIndex,
    simulate: args.simulate,
  };
}

inspectBackendTransaction({
  endpointPath: "/transactions/cancel-withdraw",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(error, printUsage);
});
