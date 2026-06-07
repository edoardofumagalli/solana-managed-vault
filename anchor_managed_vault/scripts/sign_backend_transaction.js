const anchor = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");

const EXPECTED_SCHEMA = "managed-vault.backendTransactionBuild.v1";
const DEFAULT_RPC_URL =
  process.env.MANAGED_VAULT_RPC_URL ||
  process.env.ANCHOR_PROVIDER_URL ||
  "http://127.0.0.1:8899";
const DEFAULT_MIN_BLOCKS_REMAINING = 5;

function usageError(message) {
  const error = new Error(message);
  error.showUsage = true;
  return error;
}

function parseArgs(argv) {
  const args = {
    rpcUrl: DEFAULT_RPC_URL,
    wallet: process.env.ANCHOR_WALLET,
    sign: false,
    send: false,
    minBlocksRemaining: DEFAULT_MIN_BLOCKS_REMAINING,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--sign") {
      args.sign = true;
      continue;
    }

    if (arg === "--send") {
      args.send = true;
      args.sign = true;
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

    if (key === "input") {
      args.input = value;
    } else if (key === "wallet") {
      args.wallet = value;
    } else if (key === "rpc-url") {
      args.rpcUrl = value;
    } else if (key === "min-blocks-remaining") {
      args.minBlocksRemaining = parseNonNegativeInteger(key, value);
    } else {
      throw usageError(`Unknown argument: ${arg}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw usageError("Missing required argument: --input");
  }

  if (args.sign && !args.wallet) {
    throw usageError("Missing wallet path: pass --wallet or set ANCHOR_WALLET");
  }

  return args;
}

function parseNonNegativeInteger(field, value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw usageError(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:tx:sign -- \\
    --input .tmp/deposit-transaction.json \\
    [--sign] \\
    [--send] \\
    [--wallet $ANCHOR_WALLET] \\
    [--rpc-url http://127.0.0.1:8899] \\
    [--min-blocks-remaining 5]

Modes:
  default   Review and validate the saved backend transaction build only.
  --sign   Sign locally and simulate the signed transaction, but do not send it.
  --send   Sign locally, simulate, send, and confirm the transaction.

Environment:
  ANCHOR_WALLET can be used instead of --wallet.
  MANAGED_VAULT_RPC_URL or ANCHOR_PROVIDER_URL can be used instead of --rpc-url.
`);
}

function readBuildFile(inputPath) {
  const resolvedPath = path.resolve(inputPath);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const payload = JSON.parse(raw);

  if (payload.schema !== EXPECTED_SCHEMA) {
    throw new Error(
      `Unsupported input schema: expected ${EXPECTED_SCHEMA}, received ${payload.schema}`
    );
  }

  if (!payload.response || typeof payload.response !== "object") {
    throw new Error("Input file is missing response object");
  }

  return {
    resolvedPath,
    payload,
    response: payload.response,
  };
}

function readKeypair(walletPath) {
  const resolvedPath = path.resolve(walletPath);
  const secretKeyJson = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

  if (!Array.isArray(secretKeyJson)) {
    throw new Error("Wallet file must contain a JSON array secret key");
  }

  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKeyJson));
}

function deserializeTransaction(response) {
  requireString(response.transaction, "response.transaction");
  return anchor.web3.VersionedTransaction.deserialize(
    Buffer.from(response.transaction, "base64")
  );
}

function validateResponseShape(response) {
  requireString(response.transaction, "response.transaction");
  requireString(response.feePayer, "response.feePayer");
  requireString(response.recentBlockhash, "response.recentBlockhash");

  if (!Array.isArray(response.requiredSigners)) {
    throw new Error("response.requiredSigners must be an array");
  }

  if (response.requiredSigners.length !== 1) {
    throw new Error(
      `This script currently supports exactly one required signer, received ${response.requiredSigners.length}`
    );
  }

  requireString(response.requiredSigners[0], "response.requiredSigners[0]");

  if (!Number.isSafeInteger(response.lastValidBlockHeight)) {
    throw new Error("response.lastValidBlockHeight must be a safe integer");
  }
}

function validateTransactionMatchesResponse(transaction, response) {
  const feePayer = transaction.message.staticAccountKeys[0]?.toBase58();

  if (feePayer !== response.feePayer) {
    throw new Error(
      `Transaction fee payer ${feePayer} does not match response feePayer ${response.feePayer}`
    );
  }

  if (transaction.message.recentBlockhash !== response.recentBlockhash) {
    throw new Error(
      `Transaction blockhash ${transaction.message.recentBlockhash} does not match response recentBlockhash ${response.recentBlockhash}`
    );
  }

  if (transaction.signatures.length !== response.requiredSigners.length) {
    throw new Error(
      `Transaction has ${transaction.signatures.length} signature slots, but response requires ${response.requiredSigners.length} signer(s)`
    );
  }
}

function validateUnsignedTransaction(transaction) {
  const hasNonPlaceholderSignature = transaction.signatures.some((signature) =>
    signature.some((byte) => byte !== 0)
  );

  if (hasNonPlaceholderSignature) {
    throw new Error(
      "Transaction already contains a non-placeholder signature; this script expects an unsigned backend response"
    );
  }
}

function validateSignerMatchesResponse(keypair, response) {
  const signer = keypair.publicKey.toBase58();
  const requiredSigner = response.requiredSigners[0];

  if (signer !== requiredSigner) {
    throw new Error(
      `Wallet ${signer} does not match required signer ${requiredSigner}`
    );
  }

  if (signer !== response.feePayer) {
    throw new Error(
      `Wallet ${signer} does not match fee payer ${response.feePayer}`
    );
  }
}

async function checkBlockhashFreshness(
  connection,
  response,
  minBlocksRemaining
) {
  const currentBlockHeight = await connection.getBlockHeight("confirmed");
  const blocksRemaining = response.lastValidBlockHeight - currentBlockHeight;

  console.log("\nBlockhash validity");
  console.log(`current block height: ${currentBlockHeight}`);
  console.log(`last valid block height: ${response.lastValidBlockHeight}`);
  console.log(`blocks remaining: ${blocksRemaining}`);

  if (blocksRemaining < minBlocksRemaining) {
    throw new Error(
      `Blockhash is too close to expiry: ${blocksRemaining} block(s) remaining, minimum required is ${minBlocksRemaining}. Rebuild the transaction.`
    );
  }
}

async function simulateSignedTransaction(connection, transaction) {
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: true,
  });

  console.log("\nSigned transaction simulation");
  console.log(`ok: ${simulation.value.err === null}`);
  if (simulation.value.err) {
    console.log(`error: ${JSON.stringify(simulation.value.err)}`);
  }
  if (simulation.value.unitsConsumed !== undefined) {
    console.log(`units consumed: ${simulation.value.unitsConsumed}`);
  }
  if (simulation.value.logs) {
    console.log("logs:");
    for (const log of simulation.value.logs) {
      console.log(`  ${log}`);
    }
  }

  if (simulation.value.err) {
    throw new Error("Signed transaction simulation failed; not sending");
  }
}

async function sendAndConfirmTransaction(connection, transaction, response) {
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    {
      skipPreflight: false,
    }
  );

  console.log("\nTransaction sent");
  console.log(`signature: ${signature}`);

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: response.recentBlockhash,
      lastValidBlockHeight: response.lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(
      `Transaction confirmation failed: ${JSON.stringify(
        confirmation.value.err
      )}`
    );
  }

  console.log("confirmed: true");
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function printSummary(response) {
  const summary = response.summary || {};

  console.log("Backend transaction build");
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

  if (summary.details && Object.keys(summary.details).length > 0) {
    console.log("details:");
    for (const [key, value] of Object.entries(summary.details)) {
      console.log(`  ${key}: ${value}`);
    }
  }

  console.log(`fee payer: ${response.feePayer}`);
  console.log(`required signer: ${response.requiredSigners[0]}`);
  console.log(`recent blockhash: ${response.recentBlockhash}`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const { resolvedPath, response } = readBuildFile(args.input);
  validateResponseShape(response);

  const transaction = deserializeTransaction(response);
  validateTransactionMatchesResponse(transaction, response);
  validateUnsignedTransaction(transaction);

  console.log(`input: ${resolvedPath}`);
  console.log(`rpc url: ${args.rpcUrl}`);
  printSummary(response);

  const connection = new anchor.web3.Connection(args.rpcUrl, "confirmed");
  await checkBlockhashFreshness(connection, response, args.minBlocksRemaining);

  if (!args.sign) {
    console.log("\nDry run only: transaction was not signed or sent.");
    console.log(
      "Add --sign to sign and simulate, or --send to sign, simulate, and send."
    );
    return;
  }

  const keypair = readKeypair(args.wallet);
  validateSignerMatchesResponse(keypair, response);

  transaction.sign([keypair]);
  console.log("\nTransaction signed locally");
  console.log(`signer: ${keypair.publicKey.toBase58()}`);

  await simulateSignedTransaction(connection, transaction);

  if (!args.send) {
    console.log("\nSigned transaction was not sent.");
    console.log("Run again with --send when you want to submit it.");
    return;
  }

  await sendAndConfirmTransaction(connection, transaction, response);
}

main().catch((error) => {
  console.error(error.message);
  if (error.showUsage) {
    printUsage();
  }
  process.exitCode = 1;
});
