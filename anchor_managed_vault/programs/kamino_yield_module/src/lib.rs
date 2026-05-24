pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;
pub use utils::*;

declare_id!("9YBJD5JjCfzLcPPSczbxM9QNUfV53fU9WGrpsoWCS2qm");

#[program]
pub mod kamino_yield_module {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        initialize::handler(ctx, args)
    }

    pub fn calculate_nav(ctx: Context<CalculateNav>) -> Result<()> {
        calculate_nav::handler(ctx)
    }
}
