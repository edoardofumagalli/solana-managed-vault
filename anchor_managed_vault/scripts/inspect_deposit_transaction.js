const {
  handleInspectError,
  inspectBackendTransaction,
  parseInspectArgs,
  usageError,
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
      "compute-budget-mode": "computeBudgetMode",
      "compute-unit-limit": "computeUnitLimit",
      "compute-margin-bps": "computeMarginBps",
      "compute-unit-price-micro-lamports": "computeUnitPriceMicroLamports",
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
    [--compute-budget-mode none|fixed|auto] \\
    [--compute-unit-limit <units>] \\
    [--compute-margin-bps <basis_points>] \\
    [--compute-unit-price-micro-lamports <micro_lamports>] \\
    [--output .tmp/deposit-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function parseOptionalInteger(field, value) {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw usageError(`${field} must be an unsigned integer`);
  }

  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) {
    throw usageError(`${field} is too large to be represented safely`);
  }

  return parsedValue;
}

function buildComputeBudget(args) {
  const hasComputeBudgetOption =
    args.computeBudgetMode !== undefined ||
    args.computeUnitLimit !== undefined ||
    args.computeMarginBps !== undefined ||
    args.computeUnitPriceMicroLamports !== undefined;

  if (!hasComputeBudgetOption) {
    return undefined;
  }

  if (!args.computeBudgetMode) {
    throw usageError(
      "Pass --compute-budget-mode when using compute budget options."
    );
  }

  const computeBudget = {
    mode: args.computeBudgetMode,
  };
  const unitLimit = parseOptionalInteger(
    "--compute-unit-limit",
    args.computeUnitLimit
  );
  const marginBps = parseOptionalInteger(
    "--compute-margin-bps",
    args.computeMarginBps
  );

  if (unitLimit !== undefined) {
    computeBudget.unitLimit = unitLimit;
  }

  if (marginBps !== undefined) {
    computeBudget.marginBps = marginBps;
  }

  if (args.computeUnitPriceMicroLamports !== undefined) {
    if (!/^\d+$/.test(args.computeUnitPriceMicroLamports)) {
      throw usageError(
        "--compute-unit-price-micro-lamports must be an unsigned integer"
      );
    }

    computeBudget.microLamports = args.computeUnitPriceMicroLamports;
  }

  return computeBudget;
}

function buildRequestBody(args) {
  const requestBody = {
    vault: args.vault,
    user: args.user,
    amount: args.amount,
    simulate: args.simulate,
  };
  const computeBudget = buildComputeBudget(args);

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
