use axum::{extract::State, routing::post, Json, Router};
use solana_sdk::commitment_config::CommitmentConfig;
use tokio::task;

use crate::{
    api::{
        AcceptManagerTransactionRequest, ActivateEmergencyShutdownTransactionRequest, ApiError,
        ApiResult, CancelWithdrawTransactionRequest, DepositTransactionRequest,
        ExecuteManagerWithdrawTransactionRequest, ManagerDepositTransactionRequest,
        NominateManagerTransactionRequest, ProcessWithdrawTransactionRequest,
        ReportFloatValueTransactionRequest, RequestManagerWithdrawTransactionRequest,
        RequestWithdrawTransactionRequest, TransactionAction, TransactionBuildResponse,
        TransactionSummary,
    },
    builders::admin::{
        build_accept_manager_instruction, build_activate_emergency_shutdown_instruction,
        build_nominate_manager_instruction, parse_accept_manager_request,
        parse_activate_emergency_shutdown_request, parse_nominate_manager_request,
        resolve_accept_manager_accounts, resolve_activate_emergency_shutdown_accounts,
        resolve_nominate_manager_accounts,
    },
    builders::common::{
        ensure_emergency_admin_role, ensure_manager_role, ensure_pending_manager_role,
        with_caller_actor, with_emergency_admin_actor, with_executor_actor, with_manager_actor,
        with_pending_manager_actor,
    },
    builders::deposit::{
        build_deposit_instruction, parse_deposit_request, resolve_deposit_accounts,
    },
    builders::manager::{
        build_execute_manager_withdraw_instruction, build_manager_deposit_instruction,
        build_report_float_value_instruction, build_request_manager_withdraw_instruction,
        derive_manager_withdraw_request, parse_execute_manager_withdraw_request,
        parse_manager_deposit_request, parse_report_float_value_request,
        parse_request_manager_withdraw_request, resolve_execute_manager_withdraw_accounts,
        resolve_manager_deposit_accounts, resolve_report_float_value_accounts,
        resolve_request_manager_withdraw_accounts,
    },
    builders::withdraw::{
        build_cancel_withdraw_instruction, build_process_withdraw_instruction,
        build_request_withdraw_instruction, parse_cancel_withdraw_request,
        parse_process_withdraw_request, parse_request_withdraw_request,
        resolve_cancel_withdraw_accounts, resolve_process_withdraw_accounts,
        resolve_request_withdraw_accounts,
    },
    services::{
        rpc::{fetch_manager_withdraw_request, fetch_vault},
        transaction_builder::{build_permissionless_transaction, build_user_wallet_transaction},
        transaction_simulator::simulate_transaction_if_requested,
    },
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/deposit", post(build_deposit_transaction))
        .route(
            "/request-withdraw",
            post(build_request_withdraw_transaction),
        )
        .route("/cancel-withdraw", post(build_cancel_withdraw_transaction))
        .route(
            "/process-withdraw",
            post(build_process_withdraw_transaction),
        )
        .route("/manager-deposit", post(build_manager_deposit_transaction))
        .route(
            "/report-float-value",
            post(build_report_float_value_transaction),
        )
        .route(
            "/manager-withdraw/request",
            post(build_request_manager_withdraw_transaction),
        )
        .route(
            "/manager-withdraw/execute",
            post(build_execute_manager_withdraw_transaction),
        )
        .route(
            "/emergency-shutdown",
            post(build_activate_emergency_shutdown_transaction),
        )
        .route(
            "/nominate-manager",
            post(build_nominate_manager_transaction),
        )
        .route("/accept-manager", post(build_accept_manager_transaction))
}

async fn build_deposit_transaction(
    State(state): State<AppState>,
    Json(request): Json<DepositTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_deposit_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    let deposit_accounts = resolve_deposit_accounts(&parsed_request, &vault_state);
    let deposit_instruction = build_deposit_instruction(&deposit_accounts, parsed_request.amount);
    let unsigned_transaction = build_user_wallet_transaction(
        deposit_accounts.depositor,
        &[deposit_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: TransactionSummary::new(TransactionAction::Deposit, parsed_request.vault)
            .with_actor("user", deposit_accounts.depositor)
            .with_amount("underlying", parsed_request.amount)
            .with_account("underlying_mint", deposit_accounts.underlying_mint)
            .with_account("share_mint", deposit_accounts.share_mint)
            .with_account("vault_token_account", deposit_accounts.vault_token_account),
        simulation,
    }))
}

async fn build_cancel_withdraw_transaction(
    State(state): State<AppState>,
    Json(request): Json<CancelWithdrawTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_cancel_withdraw_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    let cancel_withdraw_accounts = resolve_cancel_withdraw_accounts(&parsed_request, &vault_state);
    let cancel_withdraw_instruction = build_cancel_withdraw_instruction(&cancel_withdraw_accounts);
    let unsigned_transaction = build_user_wallet_transaction(
        cancel_withdraw_accounts.user,
        &[cancel_withdraw_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: TransactionSummary::new(TransactionAction::CancelWithdraw, parsed_request.vault)
            .with_actor("user", cancel_withdraw_accounts.user)
            .with_account("underlying_mint", cancel_withdraw_accounts.underlying_mint)
            .with_account("share_mint", cancel_withdraw_accounts.share_mint)
            .with_account(
                "user_share_token_account",
                cancel_withdraw_accounts.user_share_token_account,
            )
            .with_account("user_position", cancel_withdraw_accounts.user_position)
            .with_account("withdraw_ticket", cancel_withdraw_accounts.withdraw_ticket)
            .with_account(
                "escrow_share_token_account",
                cancel_withdraw_accounts.escrow_share_token_account,
            )
            .with_detail("ticketIndex", cancel_withdraw_accounts.ticket_index),
        simulation,
    }))
}

async fn build_request_withdraw_transaction(
    State(state): State<AppState>,
    Json(request): Json<RequestWithdrawTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_request_withdraw_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    let request_withdraw_accounts =
        resolve_request_withdraw_accounts(&parsed_request, &vault_state);
    let request_withdraw_instruction = build_request_withdraw_instruction(
        &request_withdraw_accounts,
        parsed_request.shares_amount,
    );
    let unsigned_transaction = build_user_wallet_transaction(
        request_withdraw_accounts.user,
        &[request_withdraw_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: TransactionSummary::new(TransactionAction::RequestWithdraw, parsed_request.vault)
            .with_actor("user", request_withdraw_accounts.user)
            .with_amount("shares", parsed_request.shares_amount)
            .with_account("underlying_mint", request_withdraw_accounts.underlying_mint)
            .with_account("share_mint", request_withdraw_accounts.share_mint)
            .with_account(
                "vault_token_account",
                request_withdraw_accounts.vault_token_account,
            )
            .with_account(
                "user_share_token_account",
                request_withdraw_accounts.user_share_token_account,
            )
            .with_account("user_position", request_withdraw_accounts.user_position)
            .with_account("withdraw_ticket", request_withdraw_accounts.withdraw_ticket)
            .with_account(
                "escrow_share_token_account",
                request_withdraw_accounts.escrow_share_token_account,
            )
            .with_detail("ticketIndex", request_withdraw_accounts.ticket_index),
        simulation,
    }))
}

async fn build_process_withdraw_transaction(
    State(state): State<AppState>,
    Json(request): Json<ProcessWithdrawTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_process_withdraw_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    let process_withdraw_accounts =
        resolve_process_withdraw_accounts(&parsed_request, &vault_state);
    let process_withdraw_instruction =
        build_process_withdraw_instruction(&process_withdraw_accounts);
    let unsigned_transaction = build_permissionless_transaction(
        parsed_request.fee_payer,
        &[process_withdraw_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: TransactionSummary::new(TransactionAction::ProcessWithdraw, parsed_request.vault)
            .with_actor("fee_payer", parsed_request.fee_payer)
            .with_account("withdraw_user", process_withdraw_accounts.user)
            .with_account("underlying_mint", process_withdraw_accounts.underlying_mint)
            .with_account("share_mint", process_withdraw_accounts.share_mint)
            .with_account(
                "vault_token_account",
                process_withdraw_accounts.vault_token_account,
            )
            .with_account(
                "user_underlying_token_account",
                process_withdraw_accounts.user_underlying_token_account,
            )
            .with_account("user_position", process_withdraw_accounts.user_position)
            .with_account("withdraw_ticket", process_withdraw_accounts.withdraw_ticket)
            .with_account(
                "escrow_share_token_account",
                process_withdraw_accounts.escrow_share_token_account,
            )
            .with_detail("ticketIndex", process_withdraw_accounts.ticket_index),
        simulation,
    }))
}

async fn build_manager_deposit_transaction(
    State(state): State<AppState>,
    Json(request): Json<ManagerDepositTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_manager_deposit_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    let manager_deposit_accounts = resolve_manager_deposit_accounts(&parsed_request, &vault_state);
    let manager_deposit_instruction =
        build_manager_deposit_instruction(&manager_deposit_accounts, parsed_request.amount);
    let unsigned_transaction = build_user_wallet_transaction(
        manager_deposit_accounts.caller,
        &[manager_deposit_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: with_caller_actor(
            TransactionSummary::new(TransactionAction::ManagerDeposit, parsed_request.vault),
            manager_deposit_accounts.caller,
        )
        .with_amount("underlying", parsed_request.amount)
        .with_account("underlying_mint", manager_deposit_accounts.underlying_mint)
        .with_account(
            "caller_underlying_token_account",
            manager_deposit_accounts.caller_underlying_token_account,
        )
        .with_account(
            "vault_token_account",
            manager_deposit_accounts.vault_token_account,
        ),
        simulation,
    }))
}

async fn build_report_float_value_transaction(
    State(state): State<AppState>,
    Json(request): Json<ReportFloatValueTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_report_float_value_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    ensure_manager_role(&vault_state, parsed_request.manager)?;

    let report_float_value_accounts =
        resolve_report_float_value_accounts(&parsed_request, &vault_state);
    let report_float_value_instruction = build_report_float_value_instruction(
        &report_float_value_accounts,
        parsed_request.reported_float_value,
    );
    let unsigned_transaction = build_user_wallet_transaction(
        report_float_value_accounts.manager,
        &[report_float_value_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: with_manager_actor(
            TransactionSummary::new(TransactionAction::ReportFloatValue, parsed_request.vault),
            report_float_value_accounts.manager,
        )
        .with_amount("reported_float_value", parsed_request.reported_float_value)
        .with_account(
            "underlying_mint",
            report_float_value_accounts.underlying_mint,
        )
        .with_account(
            "vault_token_account",
            report_float_value_accounts.vault_token_account,
        ),
        simulation,
    }))
}

async fn build_request_manager_withdraw_transaction(
    State(state): State<AppState>,
    Json(request): Json<RequestManagerWithdrawTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_request_manager_withdraw_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    ensure_manager_role(&vault_state, parsed_request.manager)?;

    let request_manager_withdraw_accounts =
        resolve_request_manager_withdraw_accounts(&parsed_request, &vault_state);
    let request_manager_withdraw_instruction = build_request_manager_withdraw_instruction(
        &request_manager_withdraw_accounts,
        parsed_request.amount,
    );
    let unsigned_transaction = build_user_wallet_transaction(
        request_manager_withdraw_accounts.manager,
        &[request_manager_withdraw_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: with_manager_actor(
            TransactionSummary::new(
                TransactionAction::RequestManagerWithdraw,
                parsed_request.vault,
            ),
            request_manager_withdraw_accounts.manager,
        )
        .with_amount("underlying", parsed_request.amount)
        .with_account(
            "underlying_mint",
            request_manager_withdraw_accounts.underlying_mint,
        )
        .with_account(
            "vault_token_account",
            request_manager_withdraw_accounts.vault_token_account,
        )
        .with_account(
            "receiver_token_account",
            request_manager_withdraw_accounts.receiver_underlying_token_account,
        )
        .with_account(
            "manager_withdraw_request",
            request_manager_withdraw_accounts.manager_withdraw_request,
        )
        .with_detail("requestId", request_manager_withdraw_accounts.request_id)
        .with_detail(
            "managerWithdrawDelaySlots",
            request_manager_withdraw_accounts.manager_withdraw_delay_slots,
        ),
        simulation,
    }))
}

async fn build_execute_manager_withdraw_transaction(
    State(state): State<AppState>,
    Json(request): Json<ExecuteManagerWithdrawTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_execute_manager_withdraw_request(request)?;
    let manager_withdraw_request =
        derive_manager_withdraw_request(parsed_request.vault, parsed_request.request_id);
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state, request_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;
            let request_state =
                fetch_manager_withdraw_request(&rpc_client, &manager_withdraw_request)?;

            Ok::<_, ApiError>((
                latest_blockhash,
                last_valid_block_height,
                vault_state,
                request_state,
            ))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    let manager_withdraw_request =
        derive_manager_withdraw_request(parsed_request.vault, parsed_request.request_id);
    let execute_manager_withdraw_accounts = resolve_execute_manager_withdraw_accounts(
        &parsed_request,
        &vault_state,
        &request_state,
        manager_withdraw_request,
    )?;
    let execute_manager_withdraw_instruction =
        build_execute_manager_withdraw_instruction(&execute_manager_withdraw_accounts);
    let unsigned_transaction = build_permissionless_transaction(
        execute_manager_withdraw_accounts.executor,
        &[execute_manager_withdraw_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: with_executor_actor(
            TransactionSummary::new(
                TransactionAction::ExecuteManagerWithdraw,
                parsed_request.vault,
            ),
            execute_manager_withdraw_accounts.executor,
        )
        .with_amount("underlying", execute_manager_withdraw_accounts.amount)
        .with_account(
            "underlying_mint",
            execute_manager_withdraw_accounts.underlying_mint,
        )
        .with_account(
            "vault_token_account",
            execute_manager_withdraw_accounts.vault_token_account,
        )
        .with_account(
            "receiver_token_account",
            execute_manager_withdraw_accounts.receiver_underlying_token_account,
        )
        .with_account(
            "manager_withdraw_request",
            execute_manager_withdraw_accounts.manager_withdraw_request,
        )
        .with_account("manager", execute_manager_withdraw_accounts.manager)
        .with_detail("requestId", execute_manager_withdraw_accounts.request_id)
        .with_detail(
            "executableAfterSlot",
            execute_manager_withdraw_accounts.executable_after_slot,
        ),
        simulation,
    }))
}

async fn build_activate_emergency_shutdown_transaction(
    State(state): State<AppState>,
    Json(request): Json<ActivateEmergencyShutdownTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_activate_emergency_shutdown_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    ensure_emergency_admin_role(&vault_state, parsed_request.emergency_admin)?;

    let activate_emergency_shutdown_accounts =
        resolve_activate_emergency_shutdown_accounts(&parsed_request);
    let activate_emergency_shutdown_instruction =
        build_activate_emergency_shutdown_instruction(&activate_emergency_shutdown_accounts);
    let unsigned_transaction = build_user_wallet_transaction(
        activate_emergency_shutdown_accounts.emergency_admin,
        &[activate_emergency_shutdown_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: with_emergency_admin_actor(
            TransactionSummary::new(
                TransactionAction::ActivateEmergencyShutdown,
                parsed_request.vault,
            ),
            activate_emergency_shutdown_accounts.emergency_admin,
        ),
        simulation,
    }))
}

async fn build_nominate_manager_transaction(
    State(state): State<AppState>,
    Json(request): Json<NominateManagerTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_nominate_manager_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    ensure_manager_role(&vault_state, parsed_request.manager)?;

    let nominate_manager_accounts = resolve_nominate_manager_accounts(&parsed_request);
    let nominate_manager_instruction =
        build_nominate_manager_instruction(&nominate_manager_accounts, parsed_request.new_manager);
    let unsigned_transaction = build_user_wallet_transaction(
        nominate_manager_accounts.manager,
        &[nominate_manager_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: with_manager_actor(
            TransactionSummary::new(TransactionAction::NominateManager, parsed_request.vault),
            nominate_manager_accounts.manager,
        )
        .with_account("new_manager", parsed_request.new_manager)
        .with_account("previous_pending_manager", vault_state.pending_manager),
        simulation,
    }))
}

async fn build_accept_manager_transaction(
    State(state): State<AppState>,
    Json(request): Json<AcceptManagerTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_accept_manager_request(request)?;
    let rpc_client = state.rpc_client.clone();
    let vault_pubkey = parsed_request.vault;

    let (latest_blockhash, last_valid_block_height, vault_state) =
        task::spawn_blocking(move || {
            let (latest_blockhash, last_valid_block_height) = rpc_client
                .get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                .map_err(|error| {
                    ApiError::service_unavailable(format!("RPC request failed: {error}"))
                })?;
            let vault_state = fetch_vault(&rpc_client, &vault_pubkey)?;

            Ok::<_, ApiError>((latest_blockhash, last_valid_block_height, vault_state))
        })
        .await
        .map_err(|error| ApiError::service_unavailable(format!("RPC task failed: {error}")))??;

    ensure_pending_manager_role(&vault_state, parsed_request.pending_manager)?;

    let accept_manager_accounts = resolve_accept_manager_accounts(&parsed_request);
    let accept_manager_instruction = build_accept_manager_instruction(&accept_manager_accounts);
    let unsigned_transaction = build_user_wallet_transaction(
        accept_manager_accounts.pending_manager,
        &[accept_manager_instruction],
        latest_blockhash,
    )?;

    let simulation = simulate_transaction_if_requested(
        state.rpc_client.clone(),
        unsigned_transaction.transaction.clone(),
        parsed_request.simulate,
    )
    .await?;

    Ok(Json(TransactionBuildResponse {
        transaction: unsigned_transaction.transaction_base64,
        required_signers: unsigned_transaction
            .required_signers
            .iter()
            .map(ToString::to_string)
            .collect(),
        fee_payer: unsigned_transaction.fee_payer.to_string(),
        recent_blockhash: unsigned_transaction.recent_blockhash.to_string(),
        last_valid_block_height,
        summary: with_pending_manager_actor(
            TransactionSummary::new(TransactionAction::AcceptManager, parsed_request.vault),
            accept_manager_accounts.pending_manager,
        )
        .with_account("old_manager", vault_state.manager),
        simulation,
    }))
}
