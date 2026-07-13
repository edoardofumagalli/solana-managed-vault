use serde::Deserialize;

use super::compute_budget::ComputeBudgetRequest;

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
    #[serde(default)]
    pub compute_budget: ComputeBudgetRequest,
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
    #[serde(default)]
    pub compute_budget: ComputeBudgetRequest,
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
