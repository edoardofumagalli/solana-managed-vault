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
      "shares-amount": "sharesAmount",
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
    [--output .tmp/request-withdraw-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function buildRequestBody(args) {
  return {
    vault: args.vault,
    user: args.user,
    sharesAmount: args.sharesAmount,
    simulate: args.simulate,
  };
}

inspectBackendTransaction({
  endpointPath: "/transactions/request-withdraw",
  parseArgs,
  printUsage,
  buildRequestBody,
}).catch((error) => {
  handleInspectError(error, printUsage);
});
