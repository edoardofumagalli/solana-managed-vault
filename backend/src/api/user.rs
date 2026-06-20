use serde::Deserialize;

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
