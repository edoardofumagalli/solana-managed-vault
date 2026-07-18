-- Managed vault read-side raw event store.
--
-- This table stores managed-vault.rawEvent.v1 records as the durable,
-- append-only input for future materialized read models.

CREATE TABLE IF NOT EXISTS raw_events (
    event_id TEXT PRIMARY KEY,
    schema TEXT NOT NULL,

    cluster TEXT NOT NULL,

    source_kind TEXT NOT NULL,
    source_commitment TEXT,
    source_event_source TEXT NOT NULL,

    signature TEXT NOT NULL,
    transaction_error JSONB,

    slot BIGINT NOT NULL,
    block_time_unix BIGINT,

    order_event_index INT NOT NULL,
    order_program_event_index INT,
    order_log_index INT,
    order_instruction_index INT,
    order_inner_instruction_index INT,

    program_id TEXT NOT NULL,
    program_name TEXT,

    event_name TEXT NOT NULL,
    instruction TEXT,
    category TEXT,
    core_event BOOLEAN NOT NULL DEFAULT TRUE,
    read_models TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    vault TEXT,
    user_pubkey TEXT,
    manager_pubkey TEXT,
    ticket TEXT,
    module_entry TEXT,
    module_state TEXT,
    module_program TEXT,
    manager_withdraw_request TEXT,

    event_data JSONB NOT NULL,
    raw_event JSONB NOT NULL,

    parser_version TEXT,
    parsed_at TIMESTAMPTZ,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_events_schema_check
        CHECK (schema = 'managed-vault.rawEvent.v1'),
    CONSTRAINT raw_events_event_id_not_empty_check
        CHECK (event_id <> ''),
    CONSTRAINT raw_events_cluster_not_empty_check
        CHECK (cluster <> ''),
    CONSTRAINT raw_events_signature_not_empty_check
        CHECK (signature <> ''),
    CONSTRAINT raw_events_slot_non_negative_check
        CHECK (slot >= 0),
    CONSTRAINT raw_events_block_time_non_negative_check
        CHECK (block_time_unix IS NULL OR block_time_unix >= 0),
    CONSTRAINT raw_events_order_event_index_non_negative_check
        CHECK (order_event_index >= 0)
);

CREATE INDEX IF NOT EXISTS idx_raw_events_signature
    ON raw_events (signature);

CREATE INDEX IF NOT EXISTS idx_raw_events_order
    ON raw_events (
        slot,
        order_instruction_index,
        order_inner_instruction_index,
        order_log_index,
        order_event_index,
        event_id
    );

CREATE INDEX IF NOT EXISTS idx_raw_events_program_event
    ON raw_events (program_id, event_name, slot);

CREATE INDEX IF NOT EXISTS idx_raw_events_vault
    ON raw_events (vault, slot, order_event_index)
    WHERE vault IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raw_events_user
    ON raw_events (user_pubkey, slot)
    WHERE user_pubkey IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raw_events_ticket
    ON raw_events (ticket)
    WHERE ticket IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raw_events_module_entry
    ON raw_events (module_entry, slot)
    WHERE module_entry IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raw_events_manager
    ON raw_events (manager_pubkey, slot)
    WHERE manager_pubkey IS NOT NULL;
