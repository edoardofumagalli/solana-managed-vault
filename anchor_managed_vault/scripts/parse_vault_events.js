const anchor = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");

const OUTPUT_SCHEMA = "managed-vault.indexerEvents.v1";
const RAW_EVENT_SCHEMA = "managed-vault.rawEvent.v1";
const PARSER_VERSION = "managed-vault-event-parser-v1";
const DEFAULT_RPC_URL =
  process.env.MANAGED_VAULT_RPC_URL ||
  process.env.ANCHOR_PROVIDER_URL ||
  "http://127.0.0.1:8899";
const DEFAULT_CLUSTER = process.env.MANAGED_VAULT_CLUSTER || "localnet";
const DEFAULT_COMMITMENT = "confirmed";
const DEFAULT_IDL_PATH = path.resolve(
  __dirname,
  "../target/idl/anchor_managed_vault.json"
);
const CORE_EVENT_CATALOG = Object.freeze({
  VaultInitializedEvent: {
    instruction: "initialize_vault",
    category: "vault",
    readModels: ["vaults", "vault_event_timeline"],
  },
  EmergencyShutdownActivatedEvent: {
    instruction: "activate_emergency_shutdown",
    category: "admin",
    readModels: ["vaults", "vault_event_timeline", "manager_activity"],
  },
  DepositEvent: {
    instruction: "deposit",
    category: "user",
    readModels: [
      "vaults",
      "user_positions",
      "user_activity",
      "vault_event_timeline",
      "share_price_checkpoints",
    ],
  },
  WithdrawRequestedEvent: {
    instruction: "request_withdraw",
    category: "user",
    readModels: [
      "tickets",
      "user_positions",
      "user_activity",
      "vault_event_timeline",
    ],
  },
  WithdrawCancelledEvent: {
    instruction: "cancel_withdraw",
    category: "user",
    readModels: [
      "tickets",
      "user_positions",
      "user_activity",
      "vault_event_timeline",
    ],
  },
  WithdrawProcessedEvent: {
    instruction: "process_withdraw",
    category: "user",
    readModels: [
      "tickets",
      "user_positions",
      "user_activity",
      "vaults",
      "vault_event_timeline",
      "share_price_checkpoints",
    ],
  },
  ManagerWithdrawRequestedEvent: {
    instruction: "request_manager_withdraw",
    category: "manager",
    readModels: [
      "manager_withdraw_requests",
      "manager_activity",
      "vault_event_timeline",
    ],
  },
  ManagerWithdrawExecutedEvent: {
    instruction: "execute_manager_withdraw",
    category: "manager",
    readModels: [
      "manager_withdraw_requests",
      "manager_activity",
      "vaults",
      "vault_event_timeline",
    ],
  },
  FloatValueReportedEvent: {
    instruction: "report_float_value",
    category: "manager",
    readModels: [
      "vaults",
      "manager_activity",
      "vault_event_timeline",
      "share_price_checkpoints",
    ],
  },
  ManagerDepositEvent: {
    instruction: "manager_deposit",
    category: "manager",
    readModels: ["vaults", "manager_activity", "vault_event_timeline"],
  },
  ManagerNominatedEvent: {
    instruction: "nominate_manager",
    category: "admin",
    readModels: ["vaults", "manager_activity", "vault_event_timeline"],
  },
  ManagerAcceptedEvent: {
    instruction: "accept_manager",
    category: "admin",
    readModels: ["vaults", "manager_activity", "vault_event_timeline"],
  },
  ModuleRegisteredEvent: {
    instruction: "register_module",
    category: "module",
    readModels: [
      "modules",
      "vaults",
      "module_activity",
      "vault_event_timeline",
    ],
  },
  ModuleNavSyncedEvent: {
    instruction: "sync_module_nav",
    category: "module",
    readModels: [
      "modules",
      "vaults",
      "module_activity",
      "vault_event_timeline",
      "share_price_checkpoints",
    ],
  },
  ModuleCapitalDeployedEvent: {
    instruction: "deploy_to_module",
    category: "module",
    readModels: [
      "modules",
      "vaults",
      "module_activity",
      "vault_event_timeline",
      "share_price_checkpoints",
    ],
  },
  ModuleCapitalRecalledFromModuleEvent: {
    instruction: "recall_from_module",
    category: "module",
    readModels: [
      "modules",
      "vaults",
      "module_activity",
      "vault_event_timeline",
      "share_price_checkpoints",
    ],
  },
});

function usageError(message) {
  const error = new Error(message);
  error.showUsage = true;
  return error;
}

function parseArgs(argv) {
  const args = {
    cluster: DEFAULT_CLUSTER,
    rpcUrl: DEFAULT_RPC_URL,
    commitment: DEFAULT_COMMITMENT,
    idl: DEFAULT_IDL_PATH,
    expectedEvents: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      throw usageError(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw usageError(`Missing value for ${arg}`);
    }

    if (key === "signature") {
      args.signature = value;
    } else if (key === "cluster") {
      args.cluster = value;
    } else if (key === "expected-event") {
      args.expectedEvents.push(value);
    } else if (key === "rpc-url") {
      args.rpcUrl = value;
    } else if (key === "commitment") {
      args.commitment = parseCommitment(value);
    } else if (key === "idl") {
      args.idl = value;
    } else if (key === "program-id") {
      args.programId = value;
    } else if (key === "output") {
      args.output = value;
    } else {
      throw usageError(`Unknown argument: ${arg}`);
    }

    index += 1;
  }

  if (!args.signature) {
    throw usageError("Missing required argument: --signature");
  }

  return args;
}

function parseCommitment(value) {
  const allowed = new Set(["processed", "confirmed", "finalized"]);
  if (!allowed.has(value)) {
    throw usageError(
      "--commitment must be one of: processed, confirmed, finalized"
    );
  }
  return value;
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:events:parse -- \\
    --signature <transaction_signature> \\
    [--cluster localnet] \\
    [--rpc-url http://127.0.0.1:8899] \\
    [--commitment confirmed] \\
    [--idl target/idl/anchor_managed_vault.json] \\
    [--program-id <program_pubkey>] \\
    [--expected-event DepositEvent] \\
    [--output .tmp/vault-events.json]

Environment:
  MANAGED_VAULT_CLUSTER can be used instead of --cluster.
  MANAGED_VAULT_RPC_URL or ANCHOR_PROVIDER_URL can be used instead of --rpc-url.

Notes:
  This script is read-only. It fetches one confirmed transaction, parses Anchor
  emit! logs for the managed vault program, and prints or saves a parser run
  envelope. The envelope uses schema ${OUTPUT_SCHEMA}; each item in events[]
  uses schema ${RAW_EVENT_SCHEMA} and is the raw event record intended for the
  future read-side indexer.

  Pass --expected-event multiple times to assert that a transaction emitted
  specific core vault events.
`);
}

function readIdl(idlPath) {
  const resolvedPath = path.resolve(idlPath);
  const idl = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

  if (!Array.isArray(idl.events) || idl.events.length === 0) {
    throw new Error(`IDL ${resolvedPath} does not define events`);
  }

  return {
    idl,
    resolvedPath,
  };
}

function resolveProgramId(args, idl) {
  const programId = args.programId || idl.address || idl.metadata?.address;
  if (!programId) {
    throw new Error(
      "Program id not found in IDL. Pass --program-id explicitly."
    );
  }

  return new anchor.web3.PublicKey(programId);
}

async function fetchTransaction(connection, signature, commitment) {
  const transaction = await connection.getTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction) {
    throw new Error(
      `Transaction not found for signature ${signature} at commitment ${commitment}`
    );
  }

  if (!transaction.meta) {
    throw new Error(`Transaction ${signature} does not include metadata`);
  }

  return transaction;
}

function normalizeAnchorValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (anchor.BN.isBN(value)) {
    return value.toString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof anchor.web3.PublicKey) {
    return value.toBase58();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }

  if (Array.isArray(value)) {
    return value.map(normalizeAnchorValue);
  }

  if (typeof value === "object") {
    if (typeof value.toBase58 === "function") {
      return value.toBase58();
    }

    const normalized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      normalized[key] = normalizeAnchorValue(nestedValue);
    }
    return normalized;
  }

  return value;
}

function extractEntities(eventName, data) {
  return {
    vault: data.vault || null,
    user: data.user || data.depositor || null,
    manager: data.manager || data.current_manager || data.new_manager || null,
    ticket: data.ticket || null,
    moduleEntry: data.module_entry || null,
    moduleState: data.module_state || null,
    moduleProgram: data.module_program_id || null,
    managerWithdrawRequest: data.request || null,
  };
}

function buildRawEvent({
  args,
  event,
  catalogEntry,
  eventIndex,
  programId,
  slot,
  blockTime,
  transactionError,
  parsedAt,
}) {
  const programIdString = programId.toBase58();
  const data = normalizeAnchorValue(event.data);

  return {
    schema: RAW_EVENT_SCHEMA,
    eventId: `${args.cluster}:${args.signature}:${programIdString}:${eventIndex}`,
    cluster: args.cluster,
    source: {
      kind: "rpc_getTransaction_logs",
      commitment: args.commitment,
      eventSource: "anchor_emit_log",
    },
    transaction: {
      signature: args.signature,
      error: transactionError,
    },
    block: {
      slot,
      blockTime,
    },
    order: {
      eventIndex,
      programEventIndex: eventIndex,
      logIndex: null,
      instructionIndex: null,
      innerInstructionIndex: null,
    },
    program: {
      id: programIdString,
      name: "anchor_managed_vault",
    },
    event: {
      name: event.name,
      coreEvent: Boolean(catalogEntry),
      instruction: catalogEntry?.instruction || null,
      category: catalogEntry?.category || null,
      readModels: catalogEntry?.readModels || [],
      data,
    },
    entities: extractEntities(event.name, data),
    ingest: {
      parsedAt,
      parserVersion: PARSER_VERSION,
    },
  };
}

function decodeVaultEvents({
  args,
  idl,
  logs,
  programId,
  slot,
  blockTime,
  transactionError,
  parsedAt,
}) {
  const coder = new anchor.BorshCoder(idl);
  const parser = new anchor.EventParser(programId, coder);
  const events = [];

  for (const event of parser.parseLogs(logs)) {
    const catalogEntry = CORE_EVENT_CATALOG[event.name];
    events.push(
      buildRawEvent({
        args,
        event,
        catalogEntry,
        eventIndex: events.length,
        programId,
        slot,
        blockTime,
        transactionError,
        parsedAt,
      })
    );
  }

  return events;
}

function buildCatalogSummary(idl) {
  const idlEvents = new Set((idl.events || []).map((event) => event.name));
  const knownCoreEvents = Object.keys(CORE_EVENT_CATALOG);

  return {
    knownCoreEventCount: knownCoreEvents.length,
    idlEventCount: idlEvents.size,
    missingCoreEventsFromIdl: knownCoreEvents.filter(
      (eventName) => !idlEvents.has(eventName)
    ),
    unmappedIdlEvents: [...idlEvents].filter(
      (eventName) => !CORE_EVENT_CATALOG[eventName]
    ),
  };
}

function validateExpectedEvents(expectedEvents, events) {
  if (expectedEvents.length === 0) {
    return {
      expectedEvents,
      missingExpectedEvents: [],
      ok: true,
    };
  }

  const decodedEventNames = new Set(events.map((event) => event.event.name));
  const missingExpectedEvents = expectedEvents.filter(
    (eventName) => !decodedEventNames.has(eventName)
  );

  return {
    expectedEvents,
    missingExpectedEvents,
    ok: missingExpectedEvents.length === 0,
  };
}

function buildOutputPayload({
  args,
  idl,
  idlPath,
  programId,
  transaction,
  events,
}) {
  const logs = transaction.meta.logMessages || [];
  const transactionError = normalizeAnchorValue(transaction.meta.err);
  const expectedEventCheck = validateExpectedEvents(
    args.expectedEvents,
    events
  );

  return {
    schema: OUTPUT_SCHEMA,
    createdAt: new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    cluster: args.cluster,
    rpcUrl: args.rpcUrl,
    commitment: args.commitment,
    signature: args.signature,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    programId: programId.toBase58(),
    idl: idlPath,
    transactionError,
    logCount: logs.length,
    eventCount: events.length,
    catalog: buildCatalogSummary(idl),
    expectedEventCheck,
    events,
  };
}

function printSummary(payload) {
  console.log("Vault event parser");
  console.log(`cluster: ${payload.cluster}`);
  console.log(`signature: ${payload.signature}`);
  console.log(`slot: ${payload.slot}`);
  console.log(`block time: ${payload.blockTime}`);
  console.log(`program id: ${payload.programId}`);
  console.log(`transaction error: ${JSON.stringify(payload.transactionError)}`);
  console.log(`logs: ${payload.logCount}`);
  console.log(`events decoded: ${payload.eventCount}`);
  console.log(
    `known core events: ${payload.catalog.knownCoreEventCount}, idl events: ${payload.catalog.idlEventCount}`
  );

  if (payload.catalog.missingCoreEventsFromIdl.length > 0) {
    console.log(
      `missing core events from idl: ${payload.catalog.missingCoreEventsFromIdl.join(
        ", "
      )}`
    );
  }

  if (payload.catalog.unmappedIdlEvents.length > 0) {
    console.log(
      `unmapped idl events: ${payload.catalog.unmappedIdlEvents.join(", ")}`
    );
  }

  if (payload.expectedEventCheck.expectedEvents.length > 0) {
    console.log("\nExpected event check");
    console.log(`ok: ${payload.expectedEventCheck.ok}`);
    console.log(
      `expected: ${payload.expectedEventCheck.expectedEvents.join(", ")}`
    );
    if (payload.expectedEventCheck.missingExpectedEvents.length > 0) {
      console.log(
        `missing: ${payload.expectedEventCheck.missingExpectedEvents.join(
          ", "
        )}`
      );
    }
  }

  if (payload.events.length > 0) {
    console.log("\nDecoded events");
    for (const event of payload.events) {
      const details = [];
      if (event.event.instruction) {
        details.push(`instruction: ${event.event.instruction}`);
      }
      if (event.event.category) {
        details.push(`category: ${event.event.category}`);
      }
      console.log(
        `[${event.order.eventIndex}] ${event.event.name}${
          details.length > 0 ? ` (${details.join(", ")})` : ""
        }`
      );
      for (const [key, value] of Object.entries(event.event.data)) {
        console.log(`    ${key}: ${value}`);
      }
    }
  }
}

function writeOutputFile(outputPath, payload) {
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nSaved normalized events to ${resolvedPath}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  const args = parseArgs(argv);
  const { idl, resolvedPath: idlPath } = readIdl(args.idl);
  const programId = resolveProgramId(args, idl);
  const connection = new anchor.web3.Connection(args.rpcUrl, args.commitment);
  const parsedAt = new Date().toISOString();
  const transaction = await fetchTransaction(
    connection,
    args.signature,
    args.commitment
  );
  const logs = transaction.meta.logMessages || [];
  const transactionError = normalizeAnchorValue(transaction.meta.err);
  const events = decodeVaultEvents({
    args,
    idl,
    logs,
    programId,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    transactionError,
    parsedAt,
  });
  const payload = buildOutputPayload({
    args,
    idl,
    idlPath,
    programId,
    transaction,
    events,
  });

  printSummary(payload);

  if (args.output) {
    writeOutputFile(args.output, payload);
  } else {
    console.log("\nNormalized event payload");
    console.log(JSON.stringify(payload, null, 2));
  }

  if (!payload.expectedEventCheck.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Vault event parsing failed: ${error.message}`);

  if (error.showUsage) {
    printUsage();
  }

  process.exitCode = 1;
});
