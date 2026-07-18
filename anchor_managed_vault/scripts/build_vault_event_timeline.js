const fs = require("fs");
const path = require("path");

const INPUT_ENVELOPE_SCHEMA = "managed-vault.indexerEvents.v1";
const RAW_EVENT_SCHEMA = "managed-vault.rawEvent.v1";
const OUTPUT_SCHEMA = "managed-vault.vaultEventTimeline.v1";
const TRANSFORMER_VERSION = "managed-vault-vault-event-timeline-transformer-v1";

function usageError(message) {
  const error = new Error(message);
  error.showUsage = true;
  return error;
}

function parseArgs(argv) {
  const args = {
    inputs: [],
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

    if (key === "input") {
      args.inputs.push(value);
    } else if (key === "vault") {
      args.vault = value;
    } else if (key === "output") {
      args.output = value;
    } else {
      throw usageError(`Unknown argument: ${arg}`);
    }

    index += 1;
  }

  if (args.inputs.length === 0) {
    throw usageError("Missing required argument: --input");
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  npm run backend:events:timeline -- \\
    --input .tmp/deposit-events.json \\
    [--input .tmp/module-deploy-events.json] \\
    [--vault <vault_pubkey>] \\
    [--output .tmp/vault-event-timeline.json]

Notes:
  This script is read-only. It transforms parser outputs produced by
  backend:events:parse into a first local materialized read model:
  ${OUTPUT_SCHEMA}.

  Inputs may be parser run envelopes (${INPUT_ENVELOPE_SCHEMA}), individual
  raw events (${RAW_EVENT_SCHEMA}), or arrays of raw events. Older parser
  envelopes are accepted and normalized in memory.
`);
}

function readJsonFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  return {
    path: resolvedPath,
    value: JSON.parse(fs.readFileSync(resolvedPath, "utf8")),
  };
}

function extractRawEventsFromInput(input) {
  const value = input.value;

  if (Array.isArray(value)) {
    return value.map((event, index) =>
      normalizeRawEvent(input.path, event, null, index)
    );
  }

  if (value && value.schema === RAW_EVENT_SCHEMA) {
    return [validateRawEvent(input.path, value)];
  }

  if (value && value.schema === INPUT_ENVELOPE_SCHEMA) {
    if (!Array.isArray(value.events)) {
      throw usageError(`${input.path} does not contain an events array`);
    }

    return value.events.map((event, index) =>
      normalizeRawEvent(input.path, event, value, index)
    );
  }

  throw usageError(
    `${input.path} must be a parser envelope, raw event, or raw event array`
  );
}

function normalizeRawEvent(sourcePath, event, envelope, index) {
  if (event && event.schema === RAW_EVENT_SCHEMA) {
    return validateRawEvent(sourcePath, event);
  }

  if (event && event.eventName) {
    return validateRawEvent(
      sourcePath,
      buildRawEventFromLegacyEvent(event, envelope, index)
    );
  }

  throw usageError(
    `${sourcePath} contains an event that is not ${RAW_EVENT_SCHEMA}`
  );
}

function validateRawEvent(sourcePath, event) {
  if (!event || event.schema !== RAW_EVENT_SCHEMA) {
    throw usageError(
      `${sourcePath} contains an event that is not ${RAW_EVENT_SCHEMA}`
    );
  }

  if (!event.eventId) {
    throw usageError(`${sourcePath} contains a raw event without eventId`);
  }

  if (!event.event || !event.event.name) {
    throw usageError(`${sourcePath} contains a raw event without event.name`);
  }

  return event;
}

function buildRawEventFromLegacyEvent(event, envelope, index) {
  const eventIndex = event.eventIndex ?? index;
  const cluster = envelope?.cluster || "unknown";
  const signature =
    event.signature || envelope?.signature || "unknown-signature";
  const programId = event.programId || envelope?.programId || "unknown-program";
  const data = event.data || {};

  return {
    schema: RAW_EVENT_SCHEMA,
    eventId: `${cluster}:${signature}:${programId}:${eventIndex}`,
    cluster,
    source: {
      kind: "rpc_getTransaction_logs",
      commitment: envelope?.commitment || null,
      eventSource: event.source || "anchor_emit_log",
    },
    transaction: {
      signature,
      error: envelope?.transactionError ?? null,
    },
    block: {
      slot: event.slot ?? envelope?.slot ?? null,
      blockTime: event.blockTime ?? envelope?.blockTime ?? null,
    },
    order: {
      eventIndex,
      programEventIndex: eventIndex,
      logIndex: null,
      instructionIndex: null,
      innerInstructionIndex: null,
    },
    program: {
      id: programId,
      name: "anchor_managed_vault",
    },
    event: {
      name: event.eventName,
      coreEvent: Boolean(event.coreEvent),
      instruction: event.instruction || null,
      category: event.category || null,
      readModels: event.readModels || [],
      data,
    },
    entities: extractEntities(data),
    ingest: {
      parsedAt: envelope?.createdAt || null,
      parserVersion: envelope?.parserVersion || "legacy-parser-output",
    },
  };
}

function extractEntities(data) {
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

function uniqueByEventId(events) {
  const seen = new Set();
  const uniqueEvents = [];

  for (const event of events) {
    if (seen.has(event.eventId)) {
      continue;
    }

    seen.add(event.eventId);
    uniqueEvents.push(event);
  }

  return uniqueEvents;
}

function isTimelineEvent(event) {
  return event.event?.readModels?.includes("vault_event_timeline");
}

function eventVault(event) {
  return event.entities?.vault || event.event?.data?.vault || null;
}

function sortRawEvents(left, right) {
  return (
    compareNullableNumber(left.block?.slot, right.block?.slot) ||
    compareNullableNumber(
      left.order?.instructionIndex,
      right.order?.instructionIndex
    ) ||
    compareNullableNumber(
      left.order?.innerInstructionIndex,
      right.order?.innerInstructionIndex
    ) ||
    compareNullableNumber(left.order?.logIndex, right.order?.logIndex) ||
    compareNullableNumber(left.order?.eventIndex, right.order?.eventIndex) ||
    compareString(left.transaction?.signature, right.transaction?.signature) ||
    compareString(left.eventId, right.eventId)
  );
}

function compareNullableNumber(left, right) {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;

  if (leftMissing && rightMissing) {
    return 0;
  }
  if (leftMissing) {
    return 1;
  }
  if (rightMissing) {
    return -1;
  }

  return left - right;
}

function compareString(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function buildTimelineEntry(rawEvent, sequence) {
  const data = rawEvent.event.data || {};

  return {
    id: rawEvent.eventId,
    sequence,
    rawEventId: rawEvent.eventId,
    cluster: rawEvent.cluster,
    vault: eventVault(rawEvent),
    signature: rawEvent.transaction?.signature || null,
    slot: rawEvent.block?.slot ?? null,
    blockTime: rawEvent.block?.blockTime ?? null,
    order: rawEvent.order || {},
    action: rawEvent.event.instruction,
    eventName: rawEvent.event.name,
    category: rawEvent.event.category,
    headline: buildHeadline(rawEvent),
    actor: buildActor(data),
    subject: buildSubject(rawEvent),
    amounts: buildAmounts(rawEvent.event.name, data),
    accounts: buildAccounts(rawEvent),
    data,
  };
}

function buildActor(data) {
  const actorCandidates = [
    ["user", data.user],
    ["user", data.depositor],
    ["manager", data.manager],
    ["caller", data.caller],
    ["executor", data.executor],
    ["cranker", data.cranker],
    ["emergency_admin", data.emergency_admin],
    ["current_manager", data.current_manager],
    ["new_manager", data.new_manager],
  ];

  const actor = actorCandidates.find(([, address]) => Boolean(address));
  if (!actor) {
    return null;
  }

  return {
    role: actor[0],
    address: actor[1],
  };
}

function buildSubject(rawEvent) {
  const data = rawEvent.event.data || {};

  if (data.ticket) {
    return {
      kind: "withdraw_ticket",
      address: data.ticket,
      index: data.ticket_index || null,
    };
  }

  if (data.request) {
    return {
      kind: "manager_withdraw_request",
      address: data.request,
      id: data.request_id || null,
    };
  }

  if (data.module_entry) {
    return {
      kind: "module",
      address: data.module_entry,
      moduleProgram: data.module_program_id || null,
      moduleState: data.module_state || null,
    };
  }

  return {
    kind: "vault",
    address: eventVault(rawEvent),
  };
}

function buildAmounts(eventName, data) {
  const fieldsByEvent = {
    DepositEvent: [
      ["underlying", "assets_in"],
      ["shares", "shares_out"],
      ["total_assets_after", "total_assets_after"],
      ["total_shares_after", "total_shares_after"],
      ["float_outstanding", "float_outstanding"],
    ],
    WithdrawRequestedEvent: [["shares", "shares"]],
    WithdrawCancelledEvent: [["shares_returned", "shares_returned"]],
    WithdrawProcessedEvent: [
      ["shares_burned", "shares_burned"],
      ["underlying", "assets_out"],
      ["total_assets_after", "total_assets_after"],
      ["total_shares_after", "total_shares_after"],
    ],
    ManagerWithdrawRequestedEvent: [["underlying", "amount"]],
    ManagerWithdrawExecutedEvent: [
      ["underlying", "amount"],
      ["float_outstanding", "float_outstanding"],
      ["total_assets", "total_assets"],
    ],
    FloatValueReportedEvent: [
      ["old_float_value", "old_float_value"],
      ["new_float_value", "new_float_value"],
      ["vault_underlying_balance", "vault_underlying_balance"],
      ["total_assets", "total_assets"],
    ],
    ManagerDepositEvent: [
      ["underlying", "assets_in"],
      ["returned_float", "returned_float"],
      ["excess_amount", "excess_amount"],
      ["float_outstanding", "float_outstanding"],
      ["total_assets", "total_assets"],
    ],
    ModuleNavSyncedEvent: [
      ["old_cached_nav", "old_cached_nav"],
      ["new_cached_nav", "new_cached_nav"],
      ["modules_nav_total", "modules_nav_total"],
    ],
    ModuleCapitalDeployedEvent: [
      ["underlying", "amount"],
      ["deployed_value_after", "deployed_value_after"],
      ["old_cached_nav", "old_cached_nav"],
      ["new_cached_nav", "new_cached_nav"],
      ["modules_nav_total", "modules_nav_total"],
    ],
    ModuleCapitalRecalledFromModuleEvent: [
      ["requested_underlying", "requested_amount"],
      ["returned_underlying", "returned_amount"],
      ["old_cached_nav", "old_cached_nav"],
      ["new_cached_nav", "new_cached_nav"],
      ["modules_nav_total", "modules_nav_total"],
    ],
  };

  return (fieldsByEvent[eventName] || [["amount", "amount"]])
    .filter(([, field]) => data[field] !== undefined && data[field] !== null)
    .map(([kind, field]) => ({
      kind,
      raw: String(data[field]),
    }));
}

function buildAccounts(rawEvent) {
  const data = rawEvent.event.data || {};
  const accountFields = [
    ["vault", data.vault],
    ["user", data.user || data.depositor],
    ["manager", data.manager],
    ["ticket", data.ticket],
    ["escrow_share_token_account", data.escrow_share_token_account],
    ["request", data.request],
    [
      "receiver_underlying_token_account",
      data.receiver_underlying_token_account,
    ],
    ["underlying_mint", data.underlying_mint],
    ["share_mint", data.share_mint],
    ["vault_token_account", data.vault_token_account],
    ["module_entry", data.module_entry],
    ["module_program", data.module_program_id],
    ["module_state", data.module_state],
    ["module_token_account", data.module_token_account],
    ["module_underlying_token_account", data.module_underlying_token_account],
    ["emergency_admin", data.emergency_admin],
    ["pending_manager", data.pending_manager],
    ["current_manager", data.current_manager],
    ["new_manager", data.new_manager],
  ];

  return accountFields
    .filter(([, address]) => Boolean(address))
    .map(([role, address]) => ({
      role,
      address,
    }));
}

function buildHeadline(rawEvent) {
  const eventName = rawEvent.event.name;
  const data = rawEvent.event.data || {};

  const headlines = {
    VaultInitializedEvent: () => `Vault initialized by manager ${data.manager}`,
    EmergencyShutdownActivatedEvent: () =>
      `Emergency shutdown activated by ${data.emergency_admin}`,
    DepositEvent: () =>
      `Deposit of ${data.assets_in} underlying for ${data.shares_out} shares`,
    WithdrawRequestedEvent: () =>
      `Withdraw requested for ${data.shares} shares`,
    WithdrawCancelledEvent: () =>
      `Withdraw ticket ${data.ticket_index} cancelled`,
    WithdrawProcessedEvent: () =>
      `Withdraw ticket ${data.ticket_index} processed for ${data.assets_out} underlying`,
    ManagerWithdrawRequestedEvent: () =>
      `Manager withdraw request ${data.request_id} opened for ${data.amount}`,
    ManagerWithdrawExecutedEvent: () =>
      `Manager withdraw request ${data.request_id} executed for ${data.amount}`,
    FloatValueReportedEvent: () =>
      `Float value reported from ${data.old_float_value} to ${data.new_float_value}`,
    ManagerDepositEvent: () =>
      `Manager float returned with ${data.assets_in} underlying in`,
    ManagerNominatedEvent: () => `Manager nominated ${data.pending_manager}`,
    ManagerAcceptedEvent: () => `Manager accepted ${data.new_manager}`,
    ModuleRegisteredEvent: () => `Module registered ${data.module_entry}`,
    ModuleNavSyncedEvent: () =>
      `Module NAV synced from ${data.old_cached_nav} to ${data.new_cached_nav}`,
    ModuleCapitalDeployedEvent: () =>
      `Deployed ${data.amount} underlying to module ${data.module_entry}`,
    ModuleCapitalRecalledFromModuleEvent: () =>
      `Recalled ${data.returned_amount} underlying from module ${data.module_entry}`,
  };

  return (headlines[eventName] || (() => eventName))();
}

function buildTimelinePayload(args, rawEvents) {
  const timelineEvents = uniqueByEventId(rawEvents)
    .filter(isTimelineEvent)
    .filter((event) => !args.vault || eventVault(event) === args.vault)
    .sort(sortRawEvents);

  const entries = timelineEvents.map((event, index) =>
    buildTimelineEntry(event, index)
  );

  const vaults = [
    ...new Set(entries.map((entry) => entry.vault).filter(Boolean)),
  ];
  const clusters = [
    ...new Set(entries.map((entry) => entry.cluster).filter(Boolean)),
  ];

  return {
    schema: OUTPUT_SCHEMA,
    createdAt: new Date().toISOString(),
    transformerVersion: TRANSFORMER_VERSION,
    inputCount: args.inputs.length,
    rawEventCount: rawEvents.length,
    timelineEventCount: entries.length,
    filters: {
      vault: args.vault || null,
    },
    clusters,
    vaults,
    entries,
  };
}

function printSummary(payload) {
  console.log("Vault event timeline transformer");
  console.log(`schema: ${payload.schema}`);
  console.log(`inputs: ${payload.inputCount}`);
  console.log(`raw events read: ${payload.rawEventCount}`);
  console.log(`timeline entries: ${payload.timelineEventCount}`);
  console.log(`vault filter: ${payload.filters.vault || "(none)"}`);

  if (payload.vaults.length > 0) {
    console.log(`vaults: ${payload.vaults.join(", ")}`);
  }

  if (payload.entries.length > 0) {
    console.log("\nTimeline");
    for (const entry of payload.entries) {
      console.log(
        `[${entry.sequence}] slot ${entry.slot} ${entry.eventName}: ${entry.headline}`
      );
    }
  }
}

function writeOutputFile(outputPath, payload) {
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nSaved vault event timeline to ${resolvedPath}`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  const args = parseArgs(argv);
  const inputs = args.inputs.map(readJsonFile);
  const rawEvents = inputs.flatMap(extractRawEventsFromInput);
  const payload = buildTimelinePayload(args, rawEvents);

  printSummary(payload);

  if (args.output) {
    writeOutputFile(args.output, payload);
  } else {
    console.log("\nVault event timeline payload");
    console.log(JSON.stringify(payload, null, 2));
  }
}

try {
  main();
} catch (error) {
  console.error(`Vault event timeline failed: ${error.message}`);

  if (error.showUsage) {
    printUsage();
  }

  process.exitCode = 1;
}
