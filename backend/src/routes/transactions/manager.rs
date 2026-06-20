use axum::{extract::State, routing::post, Json, Router};

use super::common::{
    build_transaction_response, fetch_manager_withdraw_transaction_context,
    fetch_vault_transaction_context, ManagerWithdrawTransactionContext, VaultTransactionContext,
};
use crate::{
    api::{
        ApiResult, ExecuteManagerWithdrawTransactionRequest, ManagerDepositTransactionRequest,
        ReportFloatValueTransactionRequest, RequestManagerWithdrawTransactionRequest,
        TransactionAction, TransactionBuildResponse, TransactionSummary,
    },
    builders::{
        common::{ensure_manager_role, with_caller_actor, with_executor_actor, with_manager_actor},
        manager::{
            build_execute_manager_withdraw_instruction, build_manager_deposit_instruction,
            build_report_float_value_instruction, build_request_manager_withdraw_instruction,
            derive_manager_withdraw_request, parse_execute_manager_withdraw_request,
            parse_manager_deposit_request, parse_report_float_value_request,
            parse_request_manager_withdraw_request, resolve_execute_manager_withdraw_accounts,
            resolve_manager_deposit_accounts, resolve_report_float_value_accounts,
            resolve_request_manager_withdraw_accounts,
        },
    },
    services::transaction_builder::{
        build_permissionless_transaction, build_user_wallet_transaction,
    },
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
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
}

async fn build_manager_deposit_transaction(
    State(state): State<AppState>,
    Json(request): Json<ManagerDepositTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_manager_deposit_request(request)?;
    let VaultTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
    } = fetch_vault_transaction_context(state.rpc_client.clone(), parsed_request.vault).await?;

    let manager_deposit_accounts = resolve_manager_deposit_accounts(&parsed_request, &vault_state);
    let manager_deposit_instruction =
        build_manager_deposit_instruction(&manager_deposit_accounts, parsed_request.amount);
    let unsigned_transaction = build_user_wallet_transaction(
        manager_deposit_accounts.caller,
        &[manager_deposit_instruction],
        latest_blockhash,
    )?;

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_caller_actor(
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
            parsed_request.simulate,
        )
        .await?,
    ))
}

async fn build_report_float_value_transaction(
    State(state): State<AppState>,
    Json(request): Json<ReportFloatValueTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_report_float_value_request(request)?;
    let VaultTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
    } = fetch_vault_transaction_context(state.rpc_client.clone(), parsed_request.vault).await?;

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

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_manager_actor(
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
            parsed_request.simulate,
        )
        .await?,
    ))
}

async fn build_request_manager_withdraw_transaction(
    State(state): State<AppState>,
    Json(request): Json<RequestManagerWithdrawTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_request_manager_withdraw_request(request)?;
    let VaultTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
    } = fetch_vault_transaction_context(state.rpc_client.clone(), parsed_request.vault).await?;

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

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_manager_actor(
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
            parsed_request.simulate,
        )
        .await?,
    ))
}

async fn build_execute_manager_withdraw_transaction(
    State(state): State<AppState>,
    Json(request): Json<ExecuteManagerWithdrawTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_execute_manager_withdraw_request(request)?;
    let manager_withdraw_request =
        derive_manager_withdraw_request(parsed_request.vault, parsed_request.request_id);
    let ManagerWithdrawTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
        request_state,
    } = fetch_manager_withdraw_transaction_context(
        state.rpc_client.clone(),
        parsed_request.vault,
        manager_withdraw_request,
    )
    .await?;

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

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_executor_actor(
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
            parsed_request.simulate,
        )
        .await?,
    ))
}
