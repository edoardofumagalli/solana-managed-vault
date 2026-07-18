use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;

pub type ApiResult<T> = Result<Json<T>, ApiError>;

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: ApiErrorCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: ApiErrorCode, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn invalid_pubkey(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::InvalidPubkey,
            message,
        )
    }

    pub fn invalid_integer(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::InvalidInteger,
            message,
        )
    }

    pub fn invalid_amount(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::InvalidAmount,
            message,
        )
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::InvalidRequest,
            message,
        )
    }

    pub fn invalid_compute_budget(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::InvalidComputeBudget,
            message,
        )
    }

    pub fn unsupported_signer(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::UnsupportedSigner,
            message,
        )
    }

    pub fn missing_remaining_account(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::MissingRemainingAccount,
            message,
        )
    }

    pub fn forbidden_remaining_account(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::ForbiddenRemainingAccount,
            message,
        )
    }

    pub fn account_not_found(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            ApiErrorCode::AccountNotFound,
            message,
        )
    }

    pub fn invalid_account_owner(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiErrorCode::InvalidAccountOwner,
            message,
        )
    }

    pub fn account_deserialization_failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiErrorCode::AccountDeserializationFailed,
            message,
        )
    }

    pub fn invalid_account_state(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiErrorCode::InvalidAccountState,
            message,
        )
    }

    pub fn transaction_compile_failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiErrorCode::TransactionCompileFailed,
            message,
        )
    }

    pub fn transaction_serialization_failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiErrorCode::TransactionSerializationFailed,
            message,
        )
    }

    pub fn invalid_signer_role(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            ApiErrorCode::InvalidSignerRole,
            message,
        )
    }

    pub fn rpc_request_failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ApiErrorCode::RpcRequestFailed,
            message,
        )
    }

    pub fn rpc_task_failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ApiErrorCode::RpcTaskFailed,
            message,
        )
    }

    pub fn rpc_simulation_failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ApiErrorCode::RpcSimulationFailed,
            message,
        )
    }

    pub fn db_request_failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ApiErrorCode::DbRequestFailed,
            message,
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = ApiErrorBody {
            error: ApiErrorPayload {
                code: self.code.as_str(),
                message: self.message,
            },
        };

        (self.status, Json(body)).into_response()
    }
}

#[derive(Serialize)]
pub struct ApiErrorBody {
    pub error: ApiErrorPayload,
}

#[derive(Serialize)]
pub struct ApiErrorPayload {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Copy)]
pub enum ApiErrorCode {
    InvalidPubkey,
    InvalidInteger,
    InvalidAmount,
    InvalidRequest,
    InvalidComputeBudget,
    UnsupportedSigner,
    MissingRemainingAccount,
    ForbiddenRemainingAccount,
    AccountNotFound,
    InvalidAccountOwner,
    AccountDeserializationFailed,
    InvalidAccountState,
    TransactionCompileFailed,
    TransactionSerializationFailed,
    InvalidSignerRole,
    RpcRequestFailed,
    RpcTaskFailed,
    RpcSimulationFailed,
    DbRequestFailed,
}

impl ApiErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::InvalidPubkey => "INVALID_PUBKEY",
            Self::InvalidInteger => "INVALID_INTEGER",
            Self::InvalidAmount => "INVALID_AMOUNT",
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::InvalidComputeBudget => "INVALID_COMPUTE_BUDGET",
            Self::UnsupportedSigner => "UNSUPPORTED_SIGNER",
            Self::MissingRemainingAccount => "MISSING_REMAINING_ACCOUNT",
            Self::ForbiddenRemainingAccount => "FORBIDDEN_REMAINING_ACCOUNT",
            Self::AccountNotFound => "ACCOUNT_NOT_FOUND",
            Self::InvalidAccountOwner => "INVALID_ACCOUNT_OWNER",
            Self::AccountDeserializationFailed => "ACCOUNT_DESERIALIZATION_FAILED",
            Self::InvalidAccountState => "INVALID_ACCOUNT_STATE",
            Self::TransactionCompileFailed => "TRANSACTION_COMPILE_FAILED",
            Self::TransactionSerializationFailed => "TRANSACTION_SERIALIZATION_FAILED",
            Self::InvalidSignerRole => "INVALID_SIGNER_ROLE",
            Self::RpcRequestFailed => "RPC_REQUEST_FAILED",
            Self::RpcTaskFailed => "RPC_TASK_FAILED",
            Self::RpcSimulationFailed => "RPC_SIMULATION_FAILED",
            Self::DbRequestFailed => "DB_REQUEST_FAILED",
        }
    }
}
