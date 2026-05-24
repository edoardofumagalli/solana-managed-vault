use anchor_lang::prelude::*;

use crate::{
    constants::{
        KAMINO_MODULE_STATE_SEED, MODULE_CONFIG_SEED, MODULE_TYPE_OBLIGATION,
        MODULE_TYPE_TOKEN,
    },
    errors::KaminoYieldModuleError,
    state::{KaminoModuleState, ModuleConfig},
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeArgs {
    pub acting_manager: Pubkey,
    pub lending_market: Pubkey,
    pub kamino_reserve: Pubkey,
    pub module_type: u8,
    pub obligation: Pubkey,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Stored in module state. The vault program validates this relationship during sync.
    pub vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ModuleConfig::INIT_SPACE,
        seeds = [MODULE_CONFIG_SEED, vault.key().as_ref()],
        bump,
    )]
    pub module_config: Account<'info, ModuleConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + KaminoModuleState::INIT_SPACE,
        seeds = [KAMINO_MODULE_STATE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub kamino_module_state: Account<'info, KaminoModuleState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    require!(
        args.module_type == MODULE_TYPE_TOKEN || args.module_type == MODULE_TYPE_OBLIGATION,
        KaminoYieldModuleError::InvalidModuleType
    );

    if args.module_type == MODULE_TYPE_OBLIGATION {
        require!(
            args.obligation != Pubkey::default(),
            KaminoYieldModuleError::InvalidObligation
        );
    }

    let clock = Clock::get()?;

    ctx.accounts.module_config.set_inner(ModuleConfig {
        bump: ctx.bumps.module_config,
        vault: ctx.accounts.vault.key(),
        acting_manager: args.acting_manager,
        lending_market: args.lending_market,
        kamino_reserve: args.kamino_reserve,
        module_type: args.module_type,
        obligation: args.obligation,
    });

    ctx.accounts
        .kamino_module_state
        .set_inner(KaminoModuleState {
            bump: ctx.bumps.kamino_module_state,
            vault: ctx.accounts.vault.key(),
            cached_nav: 0,
            last_updated_slot: clock.slot,
            kamino_reserve: args.kamino_reserve,
            lending_market: args.lending_market,
            module_type: args.module_type,
            obligation: args.obligation,
            is_initialized: true,
        });

    Ok(())
}
