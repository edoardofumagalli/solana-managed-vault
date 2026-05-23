use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("AZjFTHJFBduuqPf1Gtado4r59rJ8zYqSNFPhiYFDUDzr");

#[program]
pub mod anchor_managed_vault {
    use super::*;
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        max_float_bps: u16,
        emergency_admin: Pubkey,
        manager_withdraw_delay_slots: u64,
    ) -> Result<()> {
        instructions::initialize_vault::handler(
            ctx,
            max_float_bps,
            emergency_admin,
            manager_withdraw_delay_slots,
        )
    }

    pub fn activate_emergency_shutdown(ctx: Context<ActivateEmergencyShutdown>) -> Result<()> {
        instructions::activate_emergency_shutdown::handler(ctx)
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

    pub fn request_manager_withdraw(
        ctx: Context<RequestManagerWithdraw>,
        amount: u64,
    ) -> Result<()> {
        instructions::request_manager_withdraw::handler(ctx, amount)
    }

    pub fn execute_manager_withdraw(ctx: Context<ExecuteManagerWithdraw>) -> Result<()> {
        instructions::execute_manager_withdraw::handler(ctx)
    }

    pub fn report_float_value(
        ctx: Context<ReportFloatValue>,
        reported_float_value: u64,
    ) -> Result<()> {
        instructions::report_float_value::handler(ctx, reported_float_value)
    }

    pub fn register_module(ctx: Context<RegisterModule>, policy_seed: u64) -> Result<()> {
        instructions::register_module::handler(ctx, policy_seed)
    }

    pub fn sync_module_nav(ctx: Context<SyncModuleNav>) -> Result<()> {
        instructions::sync_module_nav::handler(ctx)
    }

    pub fn deploy_to_mock_module(ctx: Context<DeployToMockModule>, amount: u64) -> Result<()> {
        instructions::deploy_to_mock_module::handler(ctx, amount)
    }

    pub fn recall_from_mock_module(ctx: Context<RecallFromMockModule>, amount: u64) -> Result<()> {
        instructions::recall_from_mock_module::handler(ctx, amount)
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
