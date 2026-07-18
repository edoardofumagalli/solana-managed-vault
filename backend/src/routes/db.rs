use axum::{extract::State, Json};
use serde::Serialize;

use crate::{
    api::{ApiError, ApiResult},
    services, AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbHealthResponse {
    status: &'static str,
    database: &'static str,
}

pub async fn db_health(State(state): State<AppState>) -> ApiResult<DbHealthResponse> {
    services::db::check(&state.db_pool)
        .await
        .map_err(|error| ApiError::db_request_failed(format!("DB request failed: {error}")))?;

    Ok(Json(DbHealthResponse {
        status: "ok",
        database: "postgres",
    }))
}
