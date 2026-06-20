use serde::Deserialize;

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
