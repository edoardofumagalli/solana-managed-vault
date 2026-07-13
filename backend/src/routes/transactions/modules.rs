use axum::{extract::State, routing::post, Json, Router};

use super::common::{
    build_transaction_response, build_transaction_response_from_instructions,
    fetch_module_transaction_context, fetch_vault_transaction_context, ModuleTransactionContext,
    TransactionResponseFromInstructions, VaultTransactionContext,
};
use crate::{
    api::{
        ApiResult, DeployToModuleTransactionRequest, RecallFromModuleTransactionRequest,
        RegisterModuleTransactionRequest, SyncModuleNavTransactionRequest, TransactionAction,
        TransactionBuildResponse, TransactionSummary,
    },
    builders::{
        common::{ensure_manager_role, with_manager_actor},
        modules::{
            build_deploy_to_module_instruction, build_recall_from_module_instruction,
            build_register_module_instruction, build_sync_module_nav_instruction,
            parse_deploy_to_module_request, parse_recall_from_module_request,
            parse_register_module_request, parse_sync_module_nav_request,
            resolve_deploy_to_module_accounts, resolve_recall_from_module_accounts,
            resolve_register_module_accounts, resolve_sync_module_nav_accounts,
        },
    },
    services::transaction_builder::{
        build_permissionless_transaction, build_user_wallet_transaction,
    },
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/modules/register", post(build_register_module_transaction))
        .route("/modules/sync-nav", post(build_sync_module_nav_transaction))
        .route("/modules/deploy", post(build_deploy_to_module_transaction))
        .route(
            "/modules/recall",
            post(build_recall_from_module_transaction),
        )
}

async fn build_register_module_transaction(
    State(state): State<AppState>,
    Json(request): Json<RegisterModuleTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_register_module_request(request)?;
    let VaultTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
    } = fetch_vault_transaction_context(state.rpc_client.clone(), parsed_request.vault).await?;

    ensure_manager_role(&vault_state, parsed_request.manager)?;

    let register_module_accounts = resolve_register_module_accounts(&parsed_request);
    let register_module_instruction = build_register_module_instruction(&register_module_accounts);
    let unsigned_transaction = build_user_wallet_transaction(
        register_module_accounts.manager,
        &[register_module_instruction],
        latest_blockhash,
    )?;

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_manager_actor(
                TransactionSummary::new(TransactionAction::RegisterModule, parsed_request.vault),
                register_module_accounts.manager,
            )
            .with_account("module_entry", register_module_accounts.module_entry)
            .with_account("module_program", register_module_accounts.module_program)
            .with_account("module_state", register_module_accounts.module_state)
            .with_account(
                "module_underlying_token_account",
                register_module_accounts.module_underlying_token_account,
            )
            .with_detail("policySeed", register_module_accounts.policy_seed),
            parsed_request.simulate,
        )
        .await?,
    ))
}

async fn build_sync_module_nav_transaction(
    State(state): State<AppState>,
    Json(request): Json<SyncModuleNavTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_sync_module_nav_request(request)?;
    let ModuleTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state: _vault_state,
        module_entry_state,
    } = fetch_module_transaction_context(
        state.rpc_client.clone(),
        parsed_request.vault,
        parsed_request.module_entry,
    )
    .await?;

    let sync_module_nav_accounts =
        resolve_sync_module_nav_accounts(&parsed_request, &module_entry_state)?;
    let sync_module_nav_instruction = build_sync_module_nav_instruction(&sync_module_nav_accounts);
    let unsigned_transaction = build_permissionless_transaction(
        sync_module_nav_accounts.cranker,
        &[sync_module_nav_instruction],
        latest_blockhash,
    )?;

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            TransactionSummary::new(TransactionAction::SyncModuleNav, parsed_request.vault)
                .with_actor("cranker", sync_module_nav_accounts.cranker)
                .with_account("module_entry", sync_module_nav_accounts.module_entry)
                .with_account("module_program", sync_module_nav_accounts.module_program)
                .with_account("module_state", sync_module_nav_accounts.module_state)
                .with_detail("policySeed", sync_module_nav_accounts.policy_seed)
                .with_detail("oldCachedNav", sync_module_nav_accounts.cached_nav)
                .with_detail(
                    "navLastUpdatedSlot",
                    sync_module_nav_accounts.nav_last_updated_slot,
                ),
            parsed_request.simulate,
        )
        .await?,
    ))
}

async fn build_deploy_to_module_transaction(
    State(state): State<AppState>,
    Json(request): Json<DeployToModuleTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_deploy_to_module_request(request)?;
    let ModuleTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
        module_entry_state,
    } = fetch_module_transaction_context(
        state.rpc_client.clone(),
        parsed_request.vault,
        parsed_request.module_entry,
    )
    .await?;

    ensure_manager_role(&vault_state, parsed_request.manager)?;

    let deploy_to_module_accounts =
        resolve_deploy_to_module_accounts(&parsed_request, &vault_state, &module_entry_state)?;
    let deploy_to_module_instruction =
        build_deploy_to_module_instruction(&deploy_to_module_accounts, parsed_request.amount);

    Ok(Json(
        build_transaction_response_from_instructions(
            state.rpc_client.clone(),
            TransactionResponseFromInstructions {
                fee_payer: deploy_to_module_accounts.manager,
                required_signers: vec![deploy_to_module_accounts.manager],
                business_instructions: vec![deploy_to_module_instruction],
                recent_blockhash: latest_blockhash,
                last_valid_block_height,
                compute_budget: parsed_request.compute_budget,
                summary: with_manager_actor(
                    TransactionSummary::new(
                        TransactionAction::DeployToModule,
                        parsed_request.vault,
                    ),
                    deploy_to_module_accounts.manager,
                )
                .with_amount("module_underlying", parsed_request.amount)
                .with_account("module_entry", deploy_to_module_accounts.module_entry)
                .with_account("module_program", deploy_to_module_accounts.module_program)
                .with_account("module_state", deploy_to_module_accounts.module_state)
                .with_account(
                    "module_underlying_token_account",
                    deploy_to_module_accounts.module_underlying_token_account,
                )
                .with_account(
                    "vault_token_account",
                    deploy_to_module_accounts.vault_token_account,
                )
                .with_account(
                    "module_call_authority",
                    deploy_to_module_accounts.module_call_authority,
                )
                .with_detail("policySeed", deploy_to_module_accounts.policy_seed)
                .with_detail("oldCachedNav", deploy_to_module_accounts.cached_nav)
                .with_detail(
                    "navLastUpdatedSlot",
                    deploy_to_module_accounts.nav_last_updated_slot,
                )
                .with_detail(
                    "remainingAccountsCount",
                    deploy_to_module_accounts.remaining_accounts.len(),
                ),
                should_simulate: parsed_request.simulate,
            },
        )
        .await?,
    ))
}

async fn build_recall_from_module_transaction(
    State(state): State<AppState>,
    Json(request): Json<RecallFromModuleTransactionRequest>,
) -> ApiResult<TransactionBuildResponse> {
    let parsed_request = parse_recall_from_module_request(request)?;
    let ModuleTransactionContext {
        latest_blockhash,
        last_valid_block_height,
        vault_state,
        module_entry_state,
    } = fetch_module_transaction_context(
        state.rpc_client.clone(),
        parsed_request.vault,
        parsed_request.module_entry,
    )
    .await?;

    ensure_manager_role(&vault_state, parsed_request.manager)?;

    let recall_from_module_accounts =
        resolve_recall_from_module_accounts(&parsed_request, &vault_state, &module_entry_state)?;
    let recall_from_module_instruction =
        build_recall_from_module_instruction(&recall_from_module_accounts, parsed_request.amount);
    let unsigned_transaction = build_user_wallet_transaction(
        recall_from_module_accounts.manager,
        &[recall_from_module_instruction],
        latest_blockhash,
    )?;

    Ok(Json(
        build_transaction_response(
            state.rpc_client.clone(),
            unsigned_transaction,
            last_valid_block_height,
            with_manager_actor(
                TransactionSummary::new(TransactionAction::RecallFromModule, parsed_request.vault),
                recall_from_module_accounts.manager,
            )
            .with_amount("module_underlying", parsed_request.amount)
            .with_account("module_entry", recall_from_module_accounts.module_entry)
            .with_account("module_program", recall_from_module_accounts.module_program)
            .with_account("module_state", recall_from_module_accounts.module_state)
            .with_account(
                "vault_token_account",
                recall_from_module_accounts.vault_token_account,
            )
            .with_account(
                "module_call_authority",
                recall_from_module_accounts.module_call_authority,
            )
            .with_detail("policySeed", recall_from_module_accounts.policy_seed)
            .with_detail("oldCachedNav", recall_from_module_accounts.cached_nav)
            .with_detail(
                "navLastUpdatedSlot",
                recall_from_module_accounts.nav_last_updated_slot,
            )
            .with_detail(
                "remainingAccountsCount",
                recall_from_module_accounts.remaining_accounts.len(),
            ),
            parsed_request.simulate,
        )
        .await?,
    ))
}
