use axum::{extract::State, Json};
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
pub struct ConfigResponse {
    cluster: String,
    rpc_url: String,
    vault_program_id: String,
}

pub async fn config(State(state): State<AppState>) -> Json<ConfigResponse> {
    Json(ConfigResponse {
        cluster: state.config.cluster.clone(),
        rpc_url: state.config.rpc_url.clone(),
        vault_program_id: state.config.vault_program_id.clone(),
    })
}
