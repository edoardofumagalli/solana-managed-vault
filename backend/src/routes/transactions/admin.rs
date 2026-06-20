use axum::{extract::State, routing::post, Json, Router};

use super::common::{
    build_transaction_response, fetch_vault_transaction_context, VaultTransactionContext,
};
use crate::{
    api::{
        AcceptManagerTransactionRequest, ActivateEmergencyShutdownTransactionRequest, ApiResult,
        NominateManagerTransactionRequest, TransactionAction, TransactionBuildResponse,
        TransactionSummary,
    },
    builders::{
        admin::{
            build_accept_manager_instruction, build_activate_emergency_shutdown_instruction,
            build_nominate_manager_instruction, parse_accept_manager_request,
            parse_activate_emergency_shutdown_request, parse_nominate_manager_request,
            resolve_accept_manager_accounts, resolve_activate_emergency_shutdown_accounts,
            resolve_nominate_manager_accounts,
        },
        common::{
            ensure_emergency_admin_role, ensure_manager_role, ensure_pending_manager_role,
            with_emergency_admin_actor, with_manager_actor, with_pending_manager_actor,
        },
    },
    services::transaction_builder::build_user_wallet_transaction,
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
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

async fn build_activate_emergency_shutdown_transaction(
    State(state): State<AppState>,
    Json(request): Json<ActivateEmergencyShutdownTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_activate_emergency_shutdown_request(request)?;
    let VaultTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
    } = fetch_vault_transaction_context(state.rpc_client.clone(), parsed_request.vault).await?;

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

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_emergency_admin_actor(
                TransactionSummary::new(
                    TransactionAction::ActivateEmergencyShutdown,
                    parsed_request.vault,
                ),
                activate_emergency_shutdown_accounts.emergency_admin,
            ),
            parsed_request.simulate,
        )
        .await?,
    ))
}

async fn build_nominate_manager_transaction(
    State(state): State<AppState>,
    Json(request): Json<NominateManagerTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_nominate_manager_request(request)?;
    let VaultTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
    } = fetch_vault_transaction_context(state.rpc_client.clone(), parsed_request.vault).await?;

    ensure_manager_role(&vault_state, parsed_request.manager)?;

    let nominate_manager_accounts = resolve_nominate_manager_accounts(&parsed_request);
    let nominate_manager_instruction =
        build_nominate_manager_instruction(&nominate_manager_accounts, parsed_request.new_manager);
    let unsigned_transaction = build_user_wallet_transaction(
        nominate_manager_accounts.manager,
        &[nominate_manager_instruction],
        latest_blockhash,
    )?;

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_manager_actor(
                TransactionSummary::new(TransactionAction::NominateManager, parsed_request.vault),
                nominate_manager_accounts.manager,
            )
            .with_account("new_manager", parsed_request.new_manager)
            .with_account("previous_pending_manager", vault_state.pending_manager),
            parsed_request.simulate,
        )
        .await?,
    ))
}

async fn build_accept_manager_transaction(
    State(state): State<AppState>,
    Json(request): Json<AcceptManagerTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_accept_manager_request(request)?;
    let VaultTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
    } = fetch_vault_transaction_context(state.rpc_client.clone(), parsed_request.vault).await?;

    ensure_pending_manager_role(&vault_state, parsed_request.pending_manager)?;

    let accept_manager_accounts = resolve_accept_manager_accounts(&parsed_request);
    let accept_manager_instruction = build_accept_manager_instruction(&accept_manager_accounts);
    let unsigned_transaction = build_user_wallet_transaction(
        accept_manager_accounts.pending_manager,
        &[accept_manager_instruction],
        latest_blockhash,
    )?;

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_pending_manager_actor(
                TransactionSummary::new(TransactionAction::AcceptManager, parsed_request.vault),
                accept_manager_accounts.pending_manager,
            )
            .with_account("old_manager", vault_state.manager),
            parsed_request.simulate,
        )
        .await?,
    ))
}
