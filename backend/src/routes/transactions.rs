use axum::{extract::State, routing::post, Json, Router};
use solana_sdk::commitment_config::CommitmentConfig;
use tokio::task;

use crate::{
    api::{
        ApiError, ApiResult, CancelWithdrawTransactionRequest, DepositTransactionRequest,
        ProcessWithdrawTransactionRequest, RequestWithdrawTransactionRequest, TransactionAction,
        TransactionBuildResponse, TransactionSummary,
    },
    builders::deposit::{
        build_deposit_instruction, parse_deposit_request, resolve_deposit_accounts,
    },
    builders::withdraw::{
        build_cancel_withdraw_instruction, build_process_withdraw_instruction,
        build_request_withdraw_instruction, parse_cancel_withdraw_request,
        parse_process_withdraw_request, parse_request_withdraw_request,
        resolve_cancel_withdraw_accounts, resolve_process_withdraw_accounts,
        resolve_request_withdraw_accounts,
    },
    services::{
        rpc::fetch_vault,
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
