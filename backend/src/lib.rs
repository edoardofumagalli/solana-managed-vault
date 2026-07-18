pub mod api;
pub mod builders;
pub mod config;
pub mod indexer;
pub mod repositories;
pub mod routes;
pub mod services;

use std::sync::Arc;

use config::AppConfig;
use solana_client::rpc_client::RpcClient;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub rpc_client: Arc<RpcClient>,
    pub db_pool: PgPool,
}

impl AppState {
    pub fn new(config: AppConfig, rpc_client: RpcClient, db_pool: PgPool) -> Self {
        Self {
            config: Arc::new(config),
            rpc_client: Arc::new(rpc_client),
            db_pool,
        }
    }
}
