use serde::{Deserialize, Serialize};

use super::error::ApiError;

pub const DEFAULT_COMPUTE_UNIT_MARGIN_BPS: u16 = 1_000;
pub const MAX_COMPUTE_UNIT_MARGIN_BPS: u16 = 10_000;
pub const MAX_COMPUTE_UNIT_LIMIT: u32 = 1_400_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputeBudgetMode {
    None,
    Fixed,
    Auto,
}

impl Default for ComputeBudgetMode {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeBudgetRequest {
    #[serde(default)]
    pub mode: ComputeBudgetMode,
    #[serde(default)]
    pub unit_limit: Option<u32>,
    #[serde(default)]
    pub margin_bps: Option<u16>,
    #[serde(default)]
    pub micro_lamports: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedComputeBudgetRequest {
    pub mode: ComputeBudgetMode,
    pub unit_limit: Option<u32>,
    pub margin_bps: Option<u16>,
    pub micro_lamports: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeBudgetSummary {
    pub mode: ComputeBudgetMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_units: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_units: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_bps: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub micro_lamports: Option<String>,
}

impl ComputeBudgetRequest {
    pub fn validate(&self) -> Result<ValidatedComputeBudgetRequest, ApiError> {
        match self.mode {
            ComputeBudgetMode::None => {
                reject_compute_budget_field("unitLimit", self.unit_limit.is_some(), "none")?;
                reject_compute_budget_field("marginBps", self.margin_bps.is_some(), "none")?;
                reject_compute_budget_field(
                    "microLamports",
                    self.micro_lamports.is_some(),
                    "none",
                )?;

                Ok(ValidatedComputeBudgetRequest {
                    mode: ComputeBudgetMode::None,
                    unit_limit: None,
                    margin_bps: None,
                    micro_lamports: None,
                })
            }
            ComputeBudgetMode::Fixed => {
                let unit_limit = self.unit_limit.ok_or_else(|| {
                    ApiError::invalid_compute_budget(
                        "computeBudget.unitLimit is required when computeBudget.mode is fixed",
                    )
                })?;
                validate_compute_unit_limit(unit_limit)?;
                reject_compute_budget_field("marginBps", self.margin_bps.is_some(), "fixed")?;

                Ok(ValidatedComputeBudgetRequest {
                    mode: ComputeBudgetMode::Fixed,
                    unit_limit: Some(unit_limit),
                    margin_bps: None,
                    micro_lamports: parse_micro_lamports(self.micro_lamports.as_deref())?,
                })
            }
            ComputeBudgetMode::Auto => {
                reject_compute_budget_field("unitLimit", self.unit_limit.is_some(), "auto")?;
                let margin_bps = self.margin_bps.unwrap_or(DEFAULT_COMPUTE_UNIT_MARGIN_BPS);
                validate_compute_unit_margin_bps(margin_bps)?;

                Ok(ValidatedComputeBudgetRequest {
                    mode: ComputeBudgetMode::Auto,
                    unit_limit: None,
                    margin_bps: Some(margin_bps),
                    micro_lamports: parse_micro_lamports(self.micro_lamports.as_deref())?,
                })
            }
        }
    }
}

fn reject_compute_budget_field(field: &str, present: bool, mode: &str) -> Result<(), ApiError> {
    if present {
        return Err(ApiError::invalid_compute_budget(format!(
            "computeBudget.{field} is not allowed when computeBudget.mode is {mode}"
        )));
    }

    Ok(())
}

fn validate_compute_unit_limit(unit_limit: u32) -> Result<(), ApiError> {
    if unit_limit == 0 {
        return Err(ApiError::invalid_compute_budget(
            "computeBudget.unitLimit must be greater than zero",
        ));
    }

    if unit_limit > MAX_COMPUTE_UNIT_LIMIT {
        return Err(ApiError::invalid_compute_budget(format!(
            "computeBudget.unitLimit must be less than or equal to {MAX_COMPUTE_UNIT_LIMIT}"
        )));
    }

    Ok(())
}

fn validate_compute_unit_margin_bps(margin_bps: u16) -> Result<(), ApiError> {
    if margin_bps > MAX_COMPUTE_UNIT_MARGIN_BPS {
        return Err(ApiError::invalid_compute_budget(format!(
            "computeBudget.marginBps must be less than or equal to {MAX_COMPUTE_UNIT_MARGIN_BPS}"
        )));
    }

    Ok(())
}

fn parse_micro_lamports(value: Option<&str>) -> Result<Option<u64>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(ApiError::invalid_compute_budget(
            "computeBudget.microLamports cannot be empty",
        ));
    }

    trimmed.parse::<u64>().map(Some).map_err(|_| {
        ApiError::invalid_compute_budget(
            "computeBudget.microLamports must be an unsigned integer encoded as a string",
        )
    })
}
