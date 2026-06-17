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

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function kebabToCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseInspectArgs(argv, config = {}) {
  const defaults = config.defaults || {};
  const options = {
    "backend-url": "backendUrl",
    output: "output",
    ...(config.options || {}),
  };
  const flags = {};
  for (const flag of config.flags || []) {
    flags[flag] = options[flag] || kebabToCamel(flag);
  }
  const required = config.required || [];
  const args = {
    backendUrl: process.env.MANAGED_VAULT_BACKEND_URL || DEFAULT_BACKEND_URL,
    ...defaults,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      throw usageError(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      args[flags[key]] = true;
      continue;
    }

    const target = options[key];
    if (!target) {
      throw usageError(`Unknown argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw usageError(`Missing value for ${arg}`);
    }

    args[target] = value;
    index += 1;
  }

  for (const requiredKey of required) {
    if (!args[requiredKey]) {
      throw usageError(
        `Missing required argument: --${camelToKebab(requiredKey)}`
      );
    }
  }

  return args;
}

function readJsonFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function loadFixtureRequest(args, requestName) {
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

  if (!moduleFixture.requests || !moduleFixture.requests[requestName]) {
    throw usageError(
      `Fixture module '${args.fixtureModule}' does not include requests.${requestName}`
    );
  }

  return moduleFixture.requests[requestName];
}

function isMissingRequestField(value) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function requireRequestFields(requestBody, requiredFields) {
  for (const field of requiredFields) {
    if (!isMissingRequestField(requestBody[field])) {
      continue;
    }

    if (field === "remainingAccounts") {
      throw usageError(
        "Missing remainingAccounts. Provide --fixture, --remaining-accounts-file, or --remaining-accounts-json."
      );
    }

    throw usageError(
      `Missing ${field}. Provide --fixture or pass --${camelToKebab(field)}.`
    );
  }
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

function resolveRemainingAccounts(args, fixtureRequest, requestName) {
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

  if (fixtureRequest.remainingAccounts !== undefined) {
    return normalizeRemainingAccounts(
      `fixture requests.${requestName}.remainingAccounts`,
      fixtureRequest.remainingAccounts
    );
  }

  return undefined;
}

async function postJson(endpoint, requestBody) {
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
    const error = new Error("Backend request failed");
    error.backendStatus = response.status;
    error.backendBody = parsedBody;
    throw error;
  }

  return parsedBody;
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

function deserializeResponseTransaction(response) {
  const transactionBytes = Buffer.from(response.transaction, "base64");
  return anchor.web3.VersionedTransaction.deserialize(transactionBytes);
}

function writeOutputFile(outputPath, payload) {
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nSaved transaction build response to ${resolvedPath}`);
}

async function inspectBackendTransaction(config) {
  const argv = config.argv || process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    config.printUsage();
    return;
  }

  const args = config.parseArgs(argv);
  const endpoint = new URL(config.endpointPath, args.backendUrl);
  const requestBody = config.buildRequestBody(args);
  const response = await postJson(endpoint, requestBody);
  const transaction = deserializeResponseTransaction(response);

  printBackendResponse(response);
  printDecodedTransaction(transaction);

  if (args.output) {
    writeOutputFile(args.output, {
      schema: OUTPUT_SCHEMA,
      createdAt: new Date().toISOString(),
      backendUrl: args.backendUrl,
      endpoint: endpoint.toString(),
      request: requestBody,
      response,
    });
  }
}

function handleInspectError(error, printUsage, prefix) {
  if (prefix) {
    console.error(prefix);
  }

  if (error.backendStatus !== undefined) {
    console.error(error.message);
    console.error(`status: ${error.backendStatus}`);
    console.error(JSON.stringify(error.backendBody, null, 2));
  } else {
    console.error(error.message);
  }

  if (error.showUsage) {
    printUsage();
  }

  process.exitCode = 1;
}

module.exports = {
  DEFAULT_BACKEND_URL,
  DEFAULT_FIXTURE_MODULE,
  OUTPUT_SCHEMA,
  handleInspectError,
  inspectBackendTransaction,
  loadFixtureRequest,
  parseInspectArgs,
  readJsonFile,
  requireRequestFields,
  resolveRemainingAccounts,
  usageError,
};
