use solana_sdk::{compute_budget::ComputeBudgetInstruction, instruction::Instruction};

use crate::api::{
    ApiError, ComputeBudgetMode, ComputeBudgetSummary, ValidatedComputeBudgetRequest,
    DEFAULT_COMPUTE_UNIT_MARGIN_BPS, MAX_COMPUTE_UNIT_LIMIT, MAX_COMPUTE_UNIT_MARGIN_BPS,
};

#[derive(Debug, Clone)]
pub struct ComputeBudgetInstructionPlan {
    pub instructions: Vec<Instruction>,
    pub summary: Option<ComputeBudgetSummary>,
}

pub fn build_compute_budget_instruction_plan(
    request: &ValidatedComputeBudgetRequest,
    estimated_units: Option<u64>,
) -> Result<ComputeBudgetInstructionPlan, ApiError> {
    match request.mode {
        ComputeBudgetMode::None => Ok(ComputeBudgetInstructionPlan {
            instructions: Vec::new(),
            summary: None,
        }),
        ComputeBudgetMode::Fixed => {
            let unit_limit = request.unit_limit.ok_or_else(|| {
                ApiError::invalid_compute_budget(
                    "computeBudget.unitLimit is required when computeBudget.mode is fixed",
                )
            })?;

            Ok(ComputeBudgetInstructionPlan {
                instructions: build_limit_and_price_instructions(
                    unit_limit,
                    request.micro_lamports,
                ),
                summary: Some(ComputeBudgetSummary {
                    mode: ComputeBudgetMode::Fixed,
                    requested_units: Some(unit_limit),
                    estimated_units: None,
                    margin_bps: None,
                    micro_lamports: request.micro_lamports.map(|value| value.to_string()),
                }),
            })
        }
        ComputeBudgetMode::Auto => {
            let estimated_units = estimated_units.ok_or_else(|| {
                ApiError::invalid_compute_budget(
                    "estimated compute units are required when computeBudget.mode is auto",
                )
            })?;
            let margin_bps = request
                .margin_bps
                .unwrap_or(DEFAULT_COMPUTE_UNIT_MARGIN_BPS);
            let requested_units = apply_compute_unit_margin(estimated_units, margin_bps)?;

            Ok(ComputeBudgetInstructionPlan {
                instructions: build_limit_and_price_instructions(
                    requested_units,
                    request.micro_lamports,
                ),
                summary: Some(ComputeBudgetSummary {
                    mode: ComputeBudgetMode::Auto,
                    requested_units: Some(requested_units),
                    estimated_units: Some(estimated_units),
                    margin_bps: Some(margin_bps),
                    micro_lamports: request.micro_lamports.map(|value| value.to_string()),
                }),
            })
        }
    }
}

pub fn prepend_compute_budget_instructions(
    mut compute_budget_instructions: Vec<Instruction>,
    vault_instructions: &[Instruction],
) -> Vec<Instruction> {
    compute_budget_instructions.reserve(vault_instructions.len());
    compute_budget_instructions.extend(vault_instructions.iter().cloned());
    compute_budget_instructions
}

fn build_limit_and_price_instructions(
    unit_limit: u32,
    micro_lamports: Option<u64>,
) -> Vec<Instruction> {
    let mut instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(unit_limit)];

    if let Some(micro_lamports) = micro_lamports.filter(|value| *value > 0) {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            micro_lamports,
        ));
    }

    instructions
}

fn apply_compute_unit_margin(estimated_units: u64, margin_bps: u16) -> Result<u32, ApiError> {
    if estimated_units == 0 {
        return Err(ApiError::invalid_compute_budget(
            "estimated compute units must be greater than zero",
        ));
    }

    if margin_bps > MAX_COMPUTE_UNIT_MARGIN_BPS {
        return Err(ApiError::invalid_compute_budget(format!(
            "computeBudget.marginBps must be less than or equal to {MAX_COMPUTE_UNIT_MARGIN_BPS}"
        )));
    }

    let multiplier_bps = 10_000u128 + u128::from(margin_bps);
    let requested_units = (u128::from(estimated_units) * multiplier_bps + 9_999) / 10_000;

    if requested_units > u128::from(MAX_COMPUTE_UNIT_LIMIT) {
        return Err(ApiError::invalid_compute_budget(format!(
            "auto compute budget requested {requested_units} units, which exceeds {MAX_COMPUTE_UNIT_LIMIT}"
        )));
    }

    Ok(requested_units as u32)
}
