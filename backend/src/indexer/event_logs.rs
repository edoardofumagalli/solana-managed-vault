use anchor_lang::{AnchorDeserialize, Discriminator};
use anchor_managed_vault::events::{
    DepositEvent, EmergencyShutdownActivatedEvent, FloatValueReportedEvent, ManagerAcceptedEvent,
    ManagerDepositEvent, ManagerNominatedEvent, ManagerWithdrawExecutedEvent,
    ManagerWithdrawRequestedEvent, ModuleCapitalDeployedEvent,
    ModuleCapitalRecalledFromModuleEvent, ModuleNavSyncedEvent, ModuleRegisteredEvent,
    VaultInitializedEvent, WithdrawCancelledEvent, WithdrawProcessedEvent, WithdrawRequestedEvent,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};

use crate::repositories::raw_events::RawEventRecord;

const RAW_EVENT_SCHEMA: &str = "managed-vault.rawEvent.v1";
const PARSER_VERSION: &str = "managed-vault-rust-indexer-v1";
const PROGRAM_DATA_PREFIX: &str = "Program data: ";

pub struct RawEventContext {
    pub cluster: String,
    pub signature: String,
    pub program_id: String,
    pub slot: i64,
    pub block_time_unix: Option<i64>,
    pub transaction_error: Option<Value>,
    pub parsed_at: String,
}

#[derive(Debug, Clone, Default)]
struct EventEntities {
    vault: Option<String>,
    user: Option<String>,
    manager: Option<String>,
    ticket: Option<String>,
    module_entry: Option<String>,
    module_state: Option<String>,
    module_program: Option<String>,
    manager_withdraw_request: Option<String>,
}

#[derive(Debug, Clone)]
struct DecodedVaultEvent {
    name: &'static str,
    instruction: &'static str,
    category: &'static str,
    read_models: &'static [&'static str],
    data: Value,
    entities: EventEntities,
}

pub fn decode_raw_events_from_logs(
    logs: &[String],
    context: &RawEventContext,
) -> anyhow::Result<Vec<RawEventRecord>> {
    let mut records = Vec::new();
    let mut program_stack = Vec::new();

    for (log_index, log) in logs.iter().enumerate() {
        update_program_stack(&mut program_stack, log);

        let Some(encoded) = log.strip_prefix(PROGRAM_DATA_PREFIX) else {
            continue;
        };

        let is_target_program = program_stack
            .last()
            .is_some_and(|program_id| program_id == &context.program_id);
        if !is_target_program {
            continue;
        }

        let Ok(bytes) = STANDARD.decode(encoded) else {
            continue;
        };

        let Some(event) = decode_vault_event(&bytes)? else {
            continue;
        };

        let event_index = records.len() as i32;
        records.push(build_raw_event_record(
            event,
            context,
            event_index,
            Some(log_index as i32),
        ));
    }

    Ok(records)
}

fn update_program_stack(program_stack: &mut Vec<String>, log: &str) {
    let Some(program_log) = log.strip_prefix("Program ") else {
        return;
    };

    if let Some(program_id) = program_log.strip_suffix(" success") {
        pop_program(program_stack, program_id);
        return;
    }

    if let Some((program_id, _)) = program_log.split_once(" failed:") {
        pop_program(program_stack, program_id);
        return;
    }

    if let Some((program_id, _)) = program_log.split_once(" invoke [") {
        program_stack.push(program_id.to_string());
    }
}

fn pop_program(program_stack: &mut Vec<String>, program_id: &str) {
    if program_stack.last().is_some_and(|last| last == program_id) {
        program_stack.pop();
        return;
    }

    if let Some(index) = program_stack.iter().rposition(|last| last == program_id) {
        program_stack.truncate(index);
    }
}

fn decode_vault_event(bytes: &[u8]) -> anyhow::Result<Option<DecodedVaultEvent>> {
    if bytes.len() < 8 {
        return Ok(None);
    }

    let discriminator = &bytes[..8];
    let payload = &bytes[8..];

    macro_rules! decode_event {
        ($event_type:ty, $mapper:ident) => {
            if discriminator == <$event_type as Discriminator>::DISCRIMINATOR {
                let mut payload_reader = payload;
                let event = <$event_type as AnchorDeserialize>::deserialize(&mut payload_reader)?;
                return Ok(Some($mapper(event)));
            }
        };
    }

    decode_event!(VaultInitializedEvent, vault_initialized);
    decode_event!(
        EmergencyShutdownActivatedEvent,
        emergency_shutdown_activated
    );
    decode_event!(DepositEvent, deposit);
    decode_event!(WithdrawRequestedEvent, withdraw_requested);
    decode_event!(WithdrawCancelledEvent, withdraw_cancelled);
    decode_event!(WithdrawProcessedEvent, withdraw_processed);
    decode_event!(ManagerWithdrawRequestedEvent, manager_withdraw_requested);
    decode_event!(ManagerWithdrawExecutedEvent, manager_withdraw_executed);
    decode_event!(FloatValueReportedEvent, float_value_reported);
    decode_event!(ManagerDepositEvent, manager_deposit);
    decode_event!(ManagerNominatedEvent, manager_nominated);
    decode_event!(ManagerAcceptedEvent, manager_accepted);
    decode_event!(ModuleRegisteredEvent, module_registered);
    decode_event!(ModuleNavSyncedEvent, module_nav_synced);
    decode_event!(ModuleCapitalDeployedEvent, module_capital_deployed);
    decode_event!(
        ModuleCapitalRecalledFromModuleEvent,
        module_capital_recalled
    );

    Ok(None)
}

fn build_raw_event_record(
    event: DecodedVaultEvent,
    context: &RawEventContext,
    event_index: i32,
    log_index: Option<i32>,
) -> RawEventRecord {
    let read_models = event
        .read_models
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    let event_id = format!(
        "{}:{}:{}:{}",
        context.cluster, context.signature, context.program_id, event_index
    );
    let entities_json = entities_to_json(&event.entities);

    let raw_event = json!({
        "schema": RAW_EVENT_SCHEMA,
        "eventId": event_id,
        "cluster": context.cluster,
        "source": {
            "kind": "rpc_getTransaction_logs",
            "commitment": "confirmed",
            "eventSource": "anchor_emit_log",
        },
        "transaction": {
            "signature": context.signature,
            "error": context.transaction_error,
        },
        "block": {
            "slot": context.slot,
            "blockTime": context.block_time_unix,
        },
        "order": {
            "eventIndex": event_index,
            "programEventIndex": event_index,
            "logIndex": log_index,
            "instructionIndex": null,
            "innerInstructionIndex": null,
        },
        "program": {
            "id": context.program_id,
            "name": "anchor_managed_vault",
        },
        "event": {
            "name": event.name,
            "coreEvent": true,
            "instruction": event.instruction,
            "category": event.category,
            "readModels": read_models,
            "data": event.data,
        },
        "entities": entities_json,
        "ingest": {
            "parsedAt": context.parsed_at,
            "parserVersion": PARSER_VERSION,
        },
    });

    RawEventRecord {
        event_id,
        schema: RAW_EVENT_SCHEMA.to_string(),
        cluster: context.cluster.clone(),
        source_kind: "rpc_getTransaction_logs".to_string(),
        source_commitment: Some("confirmed".to_string()),
        source_event_source: "anchor_emit_log".to_string(),
        signature: context.signature.clone(),
        transaction_error: context.transaction_error.clone(),
        slot: context.slot,
        block_time_unix: context.block_time_unix,
        order_event_index: event_index,
        order_program_event_index: Some(event_index),
        order_log_index: log_index,
        order_instruction_index: None,
        order_inner_instruction_index: None,
        program_id: context.program_id.clone(),
        program_name: Some("anchor_managed_vault".to_string()),
        event_name: event.name.to_string(),
        instruction: Some(event.instruction.to_string()),
        category: Some(event.category.to_string()),
        core_event: true,
        read_models,
        vault: event.entities.vault,
        user_pubkey: event.entities.user,
        manager_pubkey: event.entities.manager,
        ticket: event.entities.ticket,
        module_entry: event.entities.module_entry,
        module_state: event.entities.module_state,
        module_program: event.entities.module_program,
        manager_withdraw_request: event.entities.manager_withdraw_request,
        event_data: event.data,
        raw_event,
        parser_version: Some(PARSER_VERSION.to_string()),
        parsed_at: Some(context.parsed_at.clone()),
    }
}

fn entities_to_json(entities: &EventEntities) -> Value {
    json!({
        "vault": entities.vault,
        "user": entities.user,
        "manager": entities.manager,
        "ticket": entities.ticket,
        "moduleEntry": entities.module_entry,
        "moduleState": entities.module_state,
        "moduleProgram": entities.module_program,
        "managerWithdrawRequest": entities.manager_withdraw_request,
    })
}

fn pubkey(value: impl ToString) -> String {
    value.to_string()
}

fn amount(value: u64) -> String {
    value.to_string()
}

fn vault_initialized(event: VaultInitializedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "VaultInitializedEvent",
        instruction: "initialize_vault",
        category: "vault",
        read_models: &["vaults", "vault_event_timeline"],
        data: json!({
            "vault": pubkey(event.vault),
            "manager": pubkey(event.manager),
            "emergency_admin": pubkey(event.emergency_admin),
            "underlying_mint": pubkey(event.underlying_mint),
            "share_mint": pubkey(event.share_mint),
            "vault_token_account": pubkey(event.vault_token_account),
            "max_float_bps": event.max_float_bps,
            "manager_withdraw_delay_slots": amount(event.manager_withdraw_delay_slots),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.manager)),
            ..EventEntities::default()
        },
    }
}

fn emergency_shutdown_activated(event: EmergencyShutdownActivatedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "EmergencyShutdownActivatedEvent",
        instruction: "activate_emergency_shutdown",
        category: "admin",
        read_models: &["vaults", "vault_event_timeline", "manager_activity"],
        data: json!({
            "vault": pubkey(event.vault),
            "emergency_admin": pubkey(event.emergency_admin),
            "shutdown_slot": amount(event.shutdown_slot),
            "float_outstanding": amount(event.float_outstanding),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            ..EventEntities::default()
        },
    }
}

fn deposit(event: DepositEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "DepositEvent",
        instruction: "deposit",
        category: "user",
        read_models: &[
            "vaults",
            "user_positions",
            "user_activity",
            "vault_event_timeline",
            "share_price_checkpoints",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "depositor": pubkey(event.depositor),
            "assets_in": amount(event.assets_in),
            "shares_out": amount(event.shares_out),
            "total_assets_after": amount(event.total_assets_after),
            "total_shares_after": amount(event.total_shares_after),
            "float_outstanding": amount(event.float_outstanding),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            user: Some(pubkey(event.depositor)),
            ..EventEntities::default()
        },
    }
}

fn withdraw_requested(event: WithdrawRequestedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "WithdrawRequestedEvent",
        instruction: "request_withdraw",
        category: "user",
        read_models: &[
            "tickets",
            "user_positions",
            "user_activity",
            "vault_event_timeline",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "user": pubkey(event.user),
            "ticket": pubkey(event.ticket),
            "escrow_share_token_account": pubkey(event.escrow_share_token_account),
            "ticket_index": amount(event.ticket_index),
            "shares": amount(event.shares),
            "requested_slot": amount(event.requested_slot),
            "pending_ticket_count": event.pending_ticket_count,
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            user: Some(pubkey(event.user)),
            ticket: Some(pubkey(event.ticket)),
            ..EventEntities::default()
        },
    }
}

fn withdraw_cancelled(event: WithdrawCancelledEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "WithdrawCancelledEvent",
        instruction: "cancel_withdraw",
        category: "user",
        read_models: &[
            "tickets",
            "user_positions",
            "user_activity",
            "vault_event_timeline",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "user": pubkey(event.user),
            "ticket": pubkey(event.ticket),
            "escrow_share_token_account": pubkey(event.escrow_share_token_account),
            "ticket_index": amount(event.ticket_index),
            "shares_returned": amount(event.shares_returned),
            "next_ticket_to_process": amount(event.next_ticket_to_process),
            "pending_ticket_count": event.pending_ticket_count,
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            user: Some(pubkey(event.user)),
            ticket: Some(pubkey(event.ticket)),
            ..EventEntities::default()
        },
    }
}

fn withdraw_processed(event: WithdrawProcessedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "WithdrawProcessedEvent",
        instruction: "process_withdraw",
        category: "user",
        read_models: &[
            "tickets",
            "user_positions",
            "user_activity",
            "vaults",
            "vault_event_timeline",
            "share_price_checkpoints",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "user": pubkey(event.user),
            "ticket": pubkey(event.ticket),
            "escrow_share_token_account": pubkey(event.escrow_share_token_account),
            "ticket_index": amount(event.ticket_index),
            "shares_burned": amount(event.shares_burned),
            "assets_out": amount(event.assets_out),
            "total_assets_after": amount(event.total_assets_after),
            "total_shares_after": amount(event.total_shares_after),
            "next_ticket_to_process": amount(event.next_ticket_to_process),
            "pending_ticket_count": event.pending_ticket_count,
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            user: Some(pubkey(event.user)),
            ticket: Some(pubkey(event.ticket)),
            ..EventEntities::default()
        },
    }
}

fn manager_withdraw_requested(event: ManagerWithdrawRequestedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ManagerWithdrawRequestedEvent",
        instruction: "request_manager_withdraw",
        category: "manager",
        read_models: &[
            "manager_withdraw_requests",
            "manager_activity",
            "vault_event_timeline",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "manager": pubkey(event.manager),
            "request": pubkey(event.request),
            "request_id": amount(event.request_id),
            "receiver_underlying_token_account": pubkey(event.receiver_underlying_token_account),
            "amount": amount(event.amount),
            "requested_slot": amount(event.requested_slot),
            "executable_after_slot": amount(event.executable_after_slot),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.manager)),
            manager_withdraw_request: Some(pubkey(event.request)),
            ..EventEntities::default()
        },
    }
}

fn manager_withdraw_executed(event: ManagerWithdrawExecutedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ManagerWithdrawExecutedEvent",
        instruction: "execute_manager_withdraw",
        category: "manager",
        read_models: &[
            "manager_withdraw_requests",
            "manager_activity",
            "vaults",
            "vault_event_timeline",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "manager": pubkey(event.manager),
            "executor": pubkey(event.executor),
            "request": pubkey(event.request),
            "request_id": amount(event.request_id),
            "receiver_underlying_token_account": pubkey(event.receiver_underlying_token_account),
            "amount": amount(event.amount),
            "float_outstanding": amount(event.float_outstanding),
            "total_assets": amount(event.total_assets),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.manager)),
            manager_withdraw_request: Some(pubkey(event.request)),
            ..EventEntities::default()
        },
    }
}

fn float_value_reported(event: FloatValueReportedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "FloatValueReportedEvent",
        instruction: "report_float_value",
        category: "manager",
        read_models: &[
            "vaults",
            "manager_activity",
            "vault_event_timeline",
            "share_price_checkpoints",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "manager": pubkey(event.manager),
            "old_float_value": amount(event.old_float_value),
            "new_float_value": amount(event.new_float_value),
            "vault_underlying_balance": amount(event.vault_underlying_balance),
            "total_assets": amount(event.total_assets),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.manager)),
            ..EventEntities::default()
        },
    }
}

fn manager_deposit(event: ManagerDepositEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ManagerDepositEvent",
        instruction: "manager_deposit",
        category: "manager",
        read_models: &["vaults", "manager_activity", "vault_event_timeline"],
        data: json!({
            "vault": pubkey(event.vault),
            "caller": pubkey(event.caller),
            "assets_in": amount(event.assets_in),
            "returned_float": amount(event.returned_float),
            "excess_amount": amount(event.excess_amount),
            "float_outstanding": amount(event.float_outstanding),
            "total_assets": amount(event.total_assets),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.caller)),
            ..EventEntities::default()
        },
    }
}

fn manager_nominated(event: ManagerNominatedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ManagerNominatedEvent",
        instruction: "nominate_manager",
        category: "admin",
        read_models: &["vaults", "manager_activity", "vault_event_timeline"],
        data: json!({
            "vault": pubkey(event.vault),
            "current_manager": pubkey(event.current_manager),
            "pending_manager": pubkey(event.pending_manager),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.current_manager)),
            ..EventEntities::default()
        },
    }
}

fn manager_accepted(event: ManagerAcceptedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ManagerAcceptedEvent",
        instruction: "accept_manager",
        category: "admin",
        read_models: &["vaults", "manager_activity", "vault_event_timeline"],
        data: json!({
            "vault": pubkey(event.vault),
            "old_manager": pubkey(event.old_manager),
            "new_manager": pubkey(event.new_manager),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.new_manager)),
            ..EventEntities::default()
        },
    }
}

fn module_registered(event: ModuleRegisteredEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ModuleRegisteredEvent",
        instruction: "register_module",
        category: "module",
        read_models: &[
            "modules",
            "vaults",
            "module_activity",
            "vault_event_timeline",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "manager": pubkey(event.manager),
            "module_entry": pubkey(event.module_entry),
            "module_program_id": pubkey(event.module_program_id),
            "module_state": pubkey(event.module_state),
            "module_underlying_token_account": pubkey(event.module_underlying_token_account),
            "policy_seed": amount(event.policy_seed),
            "module_count": event.module_count,
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.manager)),
            module_entry: Some(pubkey(event.module_entry)),
            module_state: Some(pubkey(event.module_state)),
            module_program: Some(pubkey(event.module_program_id)),
            ..EventEntities::default()
        },
    }
}

fn module_nav_synced(event: ModuleNavSyncedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ModuleNavSyncedEvent",
        instruction: "sync_module_nav",
        category: "module",
        read_models: &[
            "modules",
            "vaults",
            "module_activity",
            "vault_event_timeline",
            "share_price_checkpoints",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "cranker": pubkey(event.cranker),
            "module_entry": pubkey(event.module_entry),
            "module_program_id": pubkey(event.module_program_id),
            "module_state": pubkey(event.module_state),
            "old_cached_nav": amount(event.old_cached_nav),
            "new_cached_nav": amount(event.new_cached_nav),
            "modules_nav_total": amount(event.modules_nav_total),
            "slot": amount(event.slot),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            module_entry: Some(pubkey(event.module_entry)),
            module_state: Some(pubkey(event.module_state)),
            module_program: Some(pubkey(event.module_program_id)),
            ..EventEntities::default()
        },
    }
}

fn module_capital_deployed(event: ModuleCapitalDeployedEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ModuleCapitalDeployedEvent",
        instruction: "deploy_to_module",
        category: "module",
        read_models: &[
            "modules",
            "vaults",
            "module_activity",
            "vault_event_timeline",
            "share_price_checkpoints",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "manager": pubkey(event.manager),
            "module_entry": pubkey(event.module_entry),
            "module_program_id": pubkey(event.module_program_id),
            "module_state": pubkey(event.module_state),
            "vault_token_account": pubkey(event.vault_token_account),
            "module_token_account": pubkey(event.module_token_account),
            "amount": amount(event.amount),
            "deployed_value_after": amount(event.deployed_value_after),
            "old_cached_nav": amount(event.old_cached_nav),
            "new_cached_nav": amount(event.new_cached_nav),
            "modules_nav_total": amount(event.modules_nav_total),
            "slot": amount(event.slot),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.manager)),
            module_entry: Some(pubkey(event.module_entry)),
            module_state: Some(pubkey(event.module_state)),
            module_program: Some(pubkey(event.module_program_id)),
            ..EventEntities::default()
        },
    }
}

fn module_capital_recalled(event: ModuleCapitalRecalledFromModuleEvent) -> DecodedVaultEvent {
    DecodedVaultEvent {
        name: "ModuleCapitalRecalledFromModuleEvent",
        instruction: "recall_from_module",
        category: "module",
        read_models: &[
            "modules",
            "vaults",
            "module_activity",
            "vault_event_timeline",
            "share_price_checkpoints",
        ],
        data: json!({
            "vault": pubkey(event.vault),
            "manager": pubkey(event.manager),
            "module_entry": pubkey(event.module_entry),
            "module_program_id": pubkey(event.module_program_id),
            "module_state": pubkey(event.module_state),
            "vault_token_account": pubkey(event.vault_token_account),
            "requested_amount": amount(event.requested_amount),
            "returned_amount": amount(event.returned_amount),
            "old_cached_nav": amount(event.old_cached_nav),
            "new_cached_nav": amount(event.new_cached_nav),
            "modules_nav_total": amount(event.modules_nav_total),
            "slot": amount(event.slot),
        }),
        entities: EventEntities {
            vault: Some(pubkey(event.vault)),
            manager: Some(pubkey(event.manager)),
            module_entry: Some(pubkey(event.module_entry)),
            module_state: Some(pubkey(event.module_state)),
            module_program: Some(pubkey(event.module_program_id)),
            ..EventEntities::default()
        },
    }
}
