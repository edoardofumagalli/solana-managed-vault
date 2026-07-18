mod config;
mod db;
mod health;
mod rpc;
mod transactions;

use axum::{routing::get, Router};
use tower_http::trace::TraceLayer;

use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route("/db/health", get(db::db_health))
        .route("/rpc/health", get(rpc::rpc_health))
        .route("/config", get(config::config))
        .nest("/transactions", transactions::router())
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}
