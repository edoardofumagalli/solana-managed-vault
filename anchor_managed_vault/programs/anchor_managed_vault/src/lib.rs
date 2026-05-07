use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("AZjFTHJFBduuqPf1Gtado4r59rJ8zYqSNFPhiYFDUDzr");

#[program]
pub mod anchor_managed_vault {
    use super::*;
    pub fn initialize_vault(ctx: Context<InitializeVault>, max_float_bps: u16) -> Result<()> {
        instructions::initialize_vault::handler(ctx, max_float_bps)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn request_withdraw(ctx: Context<RequestWithdraw>, shares_amount: u64) -> Result<()> {
        instructions::request_withdraw::handler(ctx, shares_amount)
    }

    pub fn cancel_withdraw(ctx: Context<CancelWithdraw>) -> Result<()> {
        instructions::cancel_withdraw::handler(ctx)
    }

    pub fn process_withdraw(ctx: Context<ProcessWithdraw>) -> Result<()> {
        instructions::process_withdraw::handler(ctx)
    }

    pub fn manager_withdraw(ctx: Context<ManagerWithdraw>, amount: u64) -> Result<()> {
        instructions::manager_withdraw::handler(ctx, amount)
    }

    pub fn manager_deposit(ctx: Context<ManagerDeposit>, amount: u64) -> Result<()> {
        instructions::manager_deposit::handler(ctx, amount)
    }

    pub fn nominate_manager(ctx: Context<NominateManager>, new_manager: Pubkey) -> Result<()> {
        instructions::nominate_manager::handler(ctx, new_manager)
    }

    pub fn accept_manager(ctx: Context<AcceptManager>) -> Result<()> {
        instructions::accept_manager::handler(ctx)
    }
}
