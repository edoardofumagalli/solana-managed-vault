use axum::{extract::State, Json};
use serde::Serialize;
use tokio::task;

use crate::{
    api::{ApiError, ApiResult},
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcHealthResponse {
    status: &'static str,
    cluster: String,
    rpc_url: String,
    latest_blockhash: String,
}

pub async fn rpc_health(State(state): State<AppState>) -> ApiResult<RpcHealthResponse> {
    let cluster = state.config.cluster.clone();
    let rpc_url = state.config.rpc_url.clone();
    let rpc_client = state.rpc_client.clone();

    let latest_blockhash = task::spawn_blocking(move || rpc_client.get_latest_blockhash())
        .await
        .map_err(|error| ApiError::rpc_task_failed(format!("RPC task failed: {error}")))?
        .map_err(|error| ApiError::rpc_request_failed(format!("RPC request failed: {error}")))?;

    Ok(Json(RpcHealthResponse {
        status: "ok",
        cluster,
        rpc_url,
        latest_blockhash: latest_blockhash.to_string(),
    }))
}
