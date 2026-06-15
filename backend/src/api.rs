use std::collections::BTreeMap;

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};

pub type ApiResult<T> = Result<Json<T>, ApiError>;

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: String,
    message: String,
}

impl ApiError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "BAD_REQUEST".to_string(),
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "NOT_FOUND".to_string(),
            message: message.into(),
        }
    }

    pub fn invalid_account(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "INVALID_ACCOUNT".to_string(),
            message: message.into(),
        }
    }

    pub fn invalid_signer_role(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "INVALID_SIGNER_ROLE".to_string(),
            message: message.into(),
        }
    }

    pub fn service_unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "SERVICE_UNAVAILABLE".to_string(),
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = ApiErrorBody {
            error: ApiErrorPayload {
                code: self.code,
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
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositTransactionRequest {
    pub vault: String,
    pub user: String,
    pub amount: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestWithdrawTransactionRequest {
    pub vault: String,
    pub user: String,
    pub shares_amount: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelWithdrawTransactionRequest {
    pub vault: String,
    pub user: String,
    pub ticket_index: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessWithdrawTransactionRequest {
    pub vault: String,
    pub user: String,
    pub ticket_index: String,
    pub fee_payer: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerDepositTransactionRequest {
    pub vault: String,
    pub caller: String,
    pub amount: String,
    #[serde(default)]
    pub source_token_account: Option<String>,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportFloatValueTransactionRequest {
    pub vault: String,
    pub manager: String,
    pub reported_float_value: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestManagerWithdrawTransactionRequest {
    pub vault: String,
    pub manager: String,
    pub amount: String,
    pub receiver_token_account: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteManagerWithdrawTransactionRequest {
    pub vault: String,
    pub request_id: String,
    pub fee_payer: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateEmergencyShutdownTransactionRequest {
    pub vault: String,
    pub emergency_admin: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NominateManagerTransactionRequest {
    pub vault: String,
    pub manager: String,
    pub new_manager: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptManagerTransactionRequest {
    pub vault: String,
    pub pending_manager: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterModuleTransactionRequest {
    pub vault: String,
    pub manager: String,
    pub module_program: String,
    pub module_state: String,
    pub module_underlying_token_account: String,
    pub policy_seed: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRemainingAccountRequest {
    pub pubkey: String,
    pub is_writable: bool,
    pub is_signer: bool,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployToModuleTransactionRequest {
    pub vault: String,
    pub manager: String,
    pub module_entry: String,
    pub amount: String,
    pub remaining_accounts: Vec<ModuleRemainingAccountRequest>,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallFromModuleTransactionRequest {
    pub vault: String,
    pub manager: String,
    pub module_entry: String,
    pub amount: String,
    pub remaining_accounts: Vec<ModuleRemainingAccountRequest>,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncModuleNavTransactionRequest {
    pub vault: String,
    pub module_entry: String,
    pub fee_payer: String,
    #[serde(default)]
    pub simulate: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionBuildResponse {
    pub transaction: String,
    pub required_signers: Vec<String>,
    pub fee_payer: String,
    pub recent_blockhash: String,
    pub last_valid_block_height: u64,
    pub summary: TransactionSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simulation: Option<SimulationSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSummary {
    pub action: TransactionAction,
    pub vault: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<SummaryActor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub amounts: Vec<SummaryAmount>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accounts: Vec<SummaryAccount>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub details: BTreeMap<String, String>,
}

impl TransactionSummary {
    pub fn new(action: TransactionAction, vault: impl ToString) -> Self {
        Self {
            action,
            vault: vault.to_string(),
            actor: None,
            amounts: Vec::new(),
            accounts: Vec::new(),
            details: BTreeMap::new(),
        }
    }

    pub fn with_actor(mut self, role: impl Into<String>, address: impl ToString) -> Self {
        self.actor = Some(SummaryActor {
            role: role.into(),
            address: address.to_string(),
        });
        self
    }

    pub fn with_amount(mut self, kind: impl Into<String>, raw: impl ToString) -> Self {
        self.amounts.push(SummaryAmount {
            kind: kind.into(),
            raw: raw.to_string(),
        });
        self
    }

    pub fn with_account(mut self, role: impl Into<String>, address: impl ToString) -> Self {
        self.accounts.push(SummaryAccount {
            role: role.into(),
            address: address.to_string(),
        });
        self
    }

    pub fn with_detail(mut self, key: impl Into<String>, value: impl ToString) -> Self {
        self.details.insert(key.into(), value.to_string());
        self
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum TransactionAction {
    Deposit,
    RequestWithdraw,
    CancelWithdraw,
    ProcessWithdraw,
    ManagerDeposit,
    RequestManagerWithdraw,
    ExecuteManagerWithdraw,
    ReportFloatValue,
    RegisterModule,
    DeployToModule,
    RecallFromModule,
    SyncModuleNav,
    ActivateEmergencyShutdown,
    NominateManager,
    AcceptManager,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryActor {
    pub role: String,
    pub address: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryAmount {
    pub kind: String,
    pub raw: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryAccount {
    pub role: String,
    pub address: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationSummary {
    pub ok: bool,
    pub logs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub units_consumed: Option<u64>,
}
