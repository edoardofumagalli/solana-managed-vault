use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use managed_vault_backend::{config::AppConfig, routes, services, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let config = AppConfig::from_env()?;
    let bind_address = config.bind_address;
    let rpc_client = services::rpc::create_rpc_client(&config);
    let db_pool = services::db::create_pool(&config).await?;
    let state = AppState::new(config, rpc_client, db_pool);

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
