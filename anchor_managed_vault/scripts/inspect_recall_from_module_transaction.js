const anchor = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8080";
const DEFAULT_FIXTURE_MODULE = "mockYield";
const OUTPUT_SCHEMA = "managed-vault.backendTransactionBuild.v1";

function usageError(message) {
  const error = new Error(message);
  error.showUsage = true;
  return error;
}

function parseArgs(argv) {
  const args = {
    backendUrl: process.env.MANAGED_VAULT_BACKEND_URL || DEFAULT_BACKEND_URL,
    fixtureModule: DEFAULT_FIXTURE_MODULE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--simulate") {
      args.simulate = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw usageError(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw usageError(`Missing value for ${arg}`);
    }

    if (key === "backend-url") {
      args.backendUrl = value;
    } else if (key === "fixture") {
      args.fixture = value;
    } else if (key === "fixture-module") {
      args.fixtureModule = value;
    } else if (key === "vault") {
      args.vault = value;
    } else if (key === "manager") {
      args.manager = value;
    } else if (key === "module-entry") {
      args.moduleEntry = value;
    } else if (key === "amount") {
      args.amount = value;
    } else if (key === "remaining-accounts-file") {
      args.remainingAccountsFile = value;
    } else if (key === "remaining-accounts-json") {
      args.remainingAccountsJson = value;
    } else if (key === "output") {
      args.output = value;
    } else {
      throw usageError(`Unknown argument: ${arg}`);
    }

    index += 1;
  }

  return args;
}

function printUsage() {
  console.log(`
Usage with fixture:
  npm run backend:modules:recall:inspect -- \\
    --fixture .tmp/backend-fixture.json \\
    [--fixture-module mockYield] \\
    [--amount 100000] \\
    [--simulate] \\
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
    [--output .tmp/recall-from-module-transaction.json] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
}

function readJsonFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function parseJsonArgument(field, value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw usageError(`${field} must be valid JSON: ${error.message}`);
  }
}

function normalizeRemainingAccounts(source, value) {
  const remainingAccounts = Array.isArray(value)
    ? value
    : value && Array.isArray(value.remainingAccounts)
    ? value.remainingAccounts
    : null;

  if (!remainingAccounts) {
    throw usageError(
      `${source} must be a JSON array or an object with remainingAccounts`
    );
  }

  if (remainingAccounts.length === 0) {
    throw usageError(`${source} must contain at least one remaining account`);
  }

  return remainingAccounts;
}

function loadFixtureRecallRequest(args) {
  if (!args.fixture) {
    return {};
  }

  const fixture = readJsonFile(args.fixture);
  const moduleFixture = fixture.modules && fixture.modules[args.fixtureModule];
  if (!moduleFixture) {
    throw usageError(
      `Fixture module '${args.fixtureModule}' not found in ${args.fixture}`
    );
  }

  if (!moduleFixture.requests || !moduleFixture.requests.recall) {
    throw usageError(
      `Fixture module '${args.fixtureModule}' does not include requests.recall`
    );
  }

  return moduleFixture.requests.recall;
}

function resolveRemainingAccounts(args, fixtureRequest) {
  if (args.remainingAccountsFile) {
    return normalizeRemainingAccounts(
      "--remaining-accounts-file",
      readJsonFile(args.remainingAccountsFile)
    );
  }

  if (args.remainingAccountsJson) {
    return normalizeRemainingAccounts(
      "--remaining-accounts-json",
      parseJsonArgument("--remaining-accounts-json", args.remainingAccountsJson)
    );
  }

  if (fixtureRequest.remainingAccounts) {
    return normalizeRemainingAccounts(
      "fixture requests.recall.remainingAccounts",
      fixtureRequest.remainingAccounts
    );
  }

  return undefined;
}

function resolveRequestBody(args) {
  const fixtureRequest = loadFixtureRecallRequest(args);
  const requestBody = {
    vault: args.vault || fixtureRequest.vault,
    manager: args.manager || fixtureRequest.manager,
    moduleEntry: args.moduleEntry || fixtureRequest.moduleEntry,
    amount: args.amount || fixtureRequest.amount,
    remainingAccounts: resolveRemainingAccounts(args, fixtureRequest),
    simulate:
      args.simulate !== undefined
        ? args.simulate
        : fixtureRequest.simulate || false,
  };

  const requiredFields = [
    "vault",
    "manager",
    "moduleEntry",
    "amount",
    "remainingAccounts",
  ];
  for (const field of requiredFields) {
    if (!requestBody[field]) {
      if (field === "remainingAccounts") {
        throw usageError(
          "Missing remainingAccounts. Provide --fixture, --remaining-accounts-file, or --remaining-accounts-json."
        );
      }

      const cliKey = field.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`
      );
      throw usageError(
        `Missing ${field}. Provide --fixture or pass --${cliKey}.`
      );
    }
  }

  return requestBody;
}

function accountMetaForIndex(index, message) {
  const header = message.header;
  const staticAccountKeys = message.staticAccountKeys;
  const requiredSignatures = header.numRequiredSignatures;
  const readonlySigned = header.numReadonlySignedAccounts;
  const readonlyUnsigned = header.numReadonlyUnsignedAccounts;
  const signed = index < requiredSignatures;
  const signedWritableCount = requiredSignatures - readonlySigned;
  const unsignedCount = staticAccountKeys.length - requiredSignatures;
  const unsignedWritableCount = unsignedCount - readonlyUnsigned;
  const writable = signed
    ? index < signedWritableCount
    : index - requiredSignatures < unsignedWritableCount;

  return {
    index,
    pubkey: staticAccountKeys[index].toBase58(),
    signer: signed,
    writable,
    feePayer: index === 0,
  };
}

function formatMeta(meta) {
  const flags = [];
  if (meta.feePayer) {
    flags.push("fee-payer");
  }
  if (meta.signer) {
    flags.push("signer");
  }
  flags.push(meta.writable ? "writable" : "readonly");

  return `[${meta.index}] ${meta.pubkey} (${flags.join(", ")})`;
}

function printBackendResponse(response) {
  const summary = response.summary || {};

  console.log("Backend response");
  console.log(`action: ${summary.action}`);
  console.log(`vault: ${summary.vault}`);

  if (summary.actor) {
    console.log(`actor: ${summary.actor.role} ${summary.actor.address}`);
  }

  if (Array.isArray(summary.amounts) && summary.amounts.length > 0) {
    console.log("amounts:");
    for (const amount of summary.amounts) {
      console.log(`  ${amount.kind}: ${amount.raw}`);
    }
  }

  if (Array.isArray(summary.accounts) && summary.accounts.length > 0) {
    console.log("summary accounts:");
    for (const account of summary.accounts) {
      console.log(`  ${account.role}: ${account.address}`);
    }
  }

  if (summary.details && Object.keys(summary.details).length > 0) {
    console.log("details:");
    for (const [key, value] of Object.entries(summary.details)) {
      console.log(`  ${key}: ${value}`);
    }
  }

  console.log(`fee payer: ${response.feePayer}`);
  console.log(`required signers: ${response.requiredSigners.join(", ")}`);
  console.log(`recent blockhash: ${response.recentBlockhash}`);
  console.log(`last valid block height: ${response.lastValidBlockHeight}`);

  if (response.simulation) {
    console.log("\nSimulation");
    console.log(`ok: ${response.simulation.ok}`);
    if (response.simulation.error) {
      console.log(`error: ${response.simulation.error}`);
    }
    if (response.simulation.unitsConsumed !== undefined) {
      console.log(`units consumed: ${response.simulation.unitsConsumed}`);
    }
    console.log("logs:");
    for (const log of response.simulation.logs) {
      console.log(`  ${log}`);
    }
  }
}

function printDecodedTransaction(transaction) {
  const message = transaction.message;
  const accountMetas = message.staticAccountKeys.map((_, index) =>
    accountMetaForIndex(index, message)
  );

  console.log("\nDecoded transaction");
  console.log(`version: ${transaction.version}`);
  console.log(`signature slots: ${transaction.signatures.length}`);
  console.log(`message recent blockhash: ${message.recentBlockhash}`);
  console.log("header:");
  console.log(`  required signatures: ${message.header.numRequiredSignatures}`);
  console.log(`  readonly signed: ${message.header.numReadonlySignedAccounts}`);
  console.log(
    `  readonly unsigned: ${message.header.numReadonlyUnsignedAccounts}`
  );

  console.log("\nStatic account metas");
  for (const meta of accountMetas) {
    console.log(formatMeta(meta));
  }

  console.log("\nCompiled instructions");
  message.compiledInstructions.forEach((instruction, index) => {
    const accountIndexes =
      instruction.accountKeyIndexes || instruction.accounts || [];
    const data = Buffer.from(instruction.data).toString("hex");
    const programMeta = accountMetas[instruction.programIdIndex];

    console.log(`[${index}] program: ${programMeta.pubkey}`);
    console.log(`    program id index: ${instruction.programIdIndex}`);
    console.log(`    data hex: ${data}`);
    console.log("    accounts:");
    for (const accountIndex of accountIndexes) {
      console.log(`      ${formatMeta(accountMetas[accountIndex])}`);
    }
  });
}

function writeOutputFile(outputPath, payload) {
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nSaved transaction build response to ${resolvedPath}`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const endpoint = new URL("/transactions/modules/recall", args.backendUrl);
  const requestBody = resolveRequestBody(args);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseBody = await response.text();
  const parsedBody = responseBody ? JSON.parse(responseBody) : {};

  if (!response.ok) {
    console.error("Backend request failed");
    console.error(`status: ${response.status}`);
    console.error(JSON.stringify(parsedBody, null, 2));
    process.exitCode = 1;
    return;
  }

  const transactionBytes = Buffer.from(parsedBody.transaction, "base64");
  const transaction =
    anchor.web3.VersionedTransaction.deserialize(transactionBytes);

  printBackendResponse(parsedBody);
  printDecodedTransaction(transaction);

  if (args.output) {
    writeOutputFile(args.output, {
      schema: OUTPUT_SCHEMA,
      createdAt: new Date().toISOString(),
      backendUrl: args.backendUrl,
      endpoint: endpoint.toString(),
      request: requestBody,
      response: parsedBody,
    });
  }
}

main().catch((error) => {
  console.error("Recall from module transaction inspection failed:");
  console.error(error.message);
  if (error.showUsage) {
    printUsage();
  }
  process.exitCode = 1;
});
