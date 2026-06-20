mod admin;
mod common;
mod manager;
mod modules;
mod user;

use axum::Router;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(user::router())
        .merge(manager::router())
        .merge(admin::router())
        .merge(modules::router())
}
