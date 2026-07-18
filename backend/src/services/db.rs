use sqlx::{postgres::PgPoolOptions, PgPool};

use crate::config::AppConfig;

pub async fn create_pool(config: &AppConfig) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;

    Ok(pool)
}

pub async fn check(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await?;

    Ok(())
}
