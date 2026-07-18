use std::{env, net::SocketAddr};

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:8080";
const DEFAULT_CLUSTER: &str = "localnet";
const DEFAULT_RPC_URL: &str = "http://127.0.0.1:8899";
const DEFAULT_VAULT_PROGRAM_ID: &str = "AZjFTHJFBduuqPf1Gtado4r59rJ8zYqSNFPhiYFDUDzr";
const DEFAULT_DATABASE_URL: &str =
    "postgres://managed_vault:managed_vault@127.0.0.1:5432/managed_vault_dev";

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind_address: SocketAddr,
    pub cluster: String,
    pub rpc_url: String,
    pub vault_program_id: String,
    pub database_url: String,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind_address = env::var("BACKEND_BIND_ADDRESS")
            .unwrap_or_else(|_| DEFAULT_BIND_ADDRESS.to_string())
            .parse()?;
        let cluster =
            env::var("MANAGED_VAULT_CLUSTER").unwrap_or_else(|_| DEFAULT_CLUSTER.to_string());
        let rpc_url =
            env::var("MANAGED_VAULT_RPC_URL").unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());
        let vault_program_id = env::var("MANAGED_VAULT_PROGRAM_ID")
            .unwrap_or_else(|_| DEFAULT_VAULT_PROGRAM_ID.to_string());
        let database_url =
            env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());

        Ok(Self {
            bind_address,
            cluster,
            rpc_url,
            vault_program_id,
            database_url,
        })
    }
}
