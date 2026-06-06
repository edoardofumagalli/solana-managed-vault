const anchor = require("@coral-xyz/anchor");

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8080";

function usageError(message) {
  const error = new Error(message);
  error.showUsage = true;
  return error;
}

function parseArgs(argv) {
  const args = {
    backendUrl: process.env.MANAGED_VAULT_BACKEND_URL || DEFAULT_BACKEND_URL,
    simulate: false,
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
    } else if (key === "vault") {
      args.vault = value;
    } else if (key === "user") {
      args.user = value;
    } else if (key === "amount") {
      args.amount = value;
    } else {
      throw usageError(`Unknown argument: ${arg}`);
    }

    index += 1;
  }

  for (const requiredKey of ["vault", "user", "amount"]) {
    if (!args[requiredKey]) {
      throw usageError(`Missing required argument: --${requiredKey}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:deposit:inspect -- \\
    --vault <vault_pubkey> \\
    --user <user_pubkey> \\
    --amount <base_units> \\
    [--simulate] \\
    [--backend-url http://127.0.0.1:8080]

Environment:
  MANAGED_VAULT_BACKEND_URL can be used instead of --backend-url.
`);
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
  console.log("Backend response");
  console.log(`action: ${response.summary.action}`);
  console.log(`vault: ${response.summary.vault}`);
  console.log(`amount: ${response.summary.amount}`);
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

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const endpoint = new URL("/transactions/deposit", args.backendUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      vault: args.vault,
      user: args.user,
      amount: args.amount,
      simulate: args.simulate,
    }),
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
}

main().catch((error) => {
  console.error(error.message);
  if (error.showUsage) {
    printUsage();
  }
  process.exitCode = 1;
});
