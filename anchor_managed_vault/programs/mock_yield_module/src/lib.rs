use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("AFPVi8LB8iwXAGLr72AqaG6aH8pwVYzfR5ArCiiceBWe");

#[program]
pub mod mock_yield_module {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn calculate_nav(ctx: Context<CalculateNav>) -> Result<()> {
        instructions::calculate_nav::handler(ctx)
    }
}
