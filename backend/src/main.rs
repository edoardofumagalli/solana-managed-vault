mod api;
mod builders;
mod config;
mod routes;
mod services;

use std::sync::Arc;

use config::AppConfig;
use solana_client::rpc_client::RpcClient;
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub rpc_client: Arc<RpcClient>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let config = AppConfig::from_env()?;
    let bind_address = config.bind_address;
    let rpc_client = services::rpc::create_rpc_client(&config);
    let state = AppState {
        config: Arc::new(config),
        rpc_client: Arc::new(rpc_client),
    };

    let app = routes::router(state);
    let listener = TcpListener::bind(bind_address).await?;

    tracing::info!(%bind_address, "managed vault backend listening");
    axum::serve(listener, app).await?;

    Ok(())
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "managed_vault_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}
