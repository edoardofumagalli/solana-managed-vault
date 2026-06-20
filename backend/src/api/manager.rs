use serde::Deserialize;

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
