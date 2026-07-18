#![allow(dead_code)]

use serde_json::Value;
use sqlx::{types::Json, PgPool};

#[derive(Debug, Clone)]
pub struct RawEventRecord {
    pub event_id: String,
    pub schema: String,
    pub cluster: String,
    pub source_kind: String,
    pub source_commitment: Option<String>,
    pub source_event_source: String,
    pub signature: String,
    pub transaction_error: Option<Value>,
    pub slot: i64,
    pub block_time_unix: Option<i64>,
    pub order_event_index: i32,
    pub order_program_event_index: Option<i32>,
    pub order_log_index: Option<i32>,
    pub order_instruction_index: Option<i32>,
    pub order_inner_instruction_index: Option<i32>,
    pub program_id: String,
    pub program_name: Option<String>,
    pub event_name: String,
    pub instruction: Option<String>,
    pub category: Option<String>,
    pub core_event: bool,
    pub read_models: Vec<String>,
    pub vault: Option<String>,
    pub user_pubkey: Option<String>,
    pub manager_pubkey: Option<String>,
    pub ticket: Option<String>,
    pub module_entry: Option<String>,
    pub module_state: Option<String>,
    pub module_program: Option<String>,
    pub manager_withdraw_request: Option<String>,
    pub event_data: Value,
    pub raw_event: Value,
    pub parser_version: Option<String>,
    pub parsed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RawEventInsertOutcome {
    pub event_id: String,
    pub inserted: bool,
}

pub async fn insert_raw_event(
    pool: &PgPool,
    record: &RawEventRecord,
) -> Result<RawEventInsertOutcome, sqlx::Error> {
    let transaction_error = record.transaction_error.as_ref().map(Json);

    let result = sqlx::query(
        r#"
        INSERT INTO raw_events (
            event_id,
            schema,
            cluster,
            source_kind,
            source_commitment,
            source_event_source,
            signature,
            transaction_error,
            slot,
            block_time_unix,
            order_event_index,
            order_program_event_index,
            order_log_index,
            order_instruction_index,
            order_inner_instruction_index,
            program_id,
            program_name,
            event_name,
            instruction,
            category,
            core_event,
            read_models,
            vault,
            user_pubkey,
            manager_pubkey,
            ticket,
            module_entry,
            module_state,
            module_program,
            manager_withdraw_request,
            event_data,
            raw_event,
            parser_version,
            parsed_at
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18,
            $19,
            $20,
            $21,
            $22,
            $23,
            $24,
            $25,
            $26,
            $27,
            $28,
            $29,
            $30,
            $31,
            $32,
            $33,
            $34::timestamptz
        )
        ON CONFLICT (event_id) DO NOTHING
        "#,
    )
    .bind(&record.event_id)
    .bind(&record.schema)
    .bind(&record.cluster)
    .bind(&record.source_kind)
    .bind(&record.source_commitment)
    .bind(&record.source_event_source)
    .bind(&record.signature)
    .bind(transaction_error)
    .bind(record.slot)
    .bind(record.block_time_unix)
    .bind(record.order_event_index)
    .bind(record.order_program_event_index)
    .bind(record.order_log_index)
    .bind(record.order_instruction_index)
    .bind(record.order_inner_instruction_index)
    .bind(&record.program_id)
    .bind(&record.program_name)
    .bind(&record.event_name)
    .bind(&record.instruction)
    .bind(&record.category)
    .bind(record.core_event)
    .bind(&record.read_models)
    .bind(&record.vault)
    .bind(&record.user_pubkey)
    .bind(&record.manager_pubkey)
    .bind(&record.ticket)
    .bind(&record.module_entry)
    .bind(&record.module_state)
    .bind(&record.module_program)
    .bind(&record.manager_withdraw_request)
    .bind(Json(&record.event_data))
    .bind(Json(&record.raw_event))
    .bind(&record.parser_version)
    .bind(record.parsed_at.as_deref())
    .execute(pool)
    .await?;

    Ok(RawEventInsertOutcome {
        event_id: record.event_id.clone(),
        inserted: result.rows_affected() == 1,
    })
}

pub async fn count_raw_events(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM raw_events")
        .fetch_one(pool)
        .await
}
