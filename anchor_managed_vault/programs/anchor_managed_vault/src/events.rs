use anchor_lang::prelude::*;

#[event]
pub struct VaultInitializedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub emergency_admin: Pubkey,
    pub underlying_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub max_float_bps: u16,
    pub manager_withdraw_delay_slots: u64,
}

#[event]
pub struct EmergencyShutdownActivatedEvent {
    pub vault: Pubkey,
    pub emergency_admin: Pubkey,
    pub shutdown_slot: u64,
    pub float_outstanding: u64,
}

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub depositor: Pubkey,
    pub assets_in: u64,
    pub shares_out: u64,
    pub total_assets_after: u64,
    pub total_shares_after: u64,
    pub float_outstanding: u64,
}

#[event]
pub struct WithdrawRequestedEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub ticket: Pubkey,
    pub escrow_share_token_account: Pubkey,
    pub ticket_index: u64,
    pub shares: u64,
    pub requested_slot: u64,
    pub pending_ticket_count: u8,
}

#[event]
pub struct WithdrawCancelledEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub ticket: Pubkey,
    pub escrow_share_token_account: Pubkey,
    pub ticket_index: u64,
    pub shares_returned: u64,
    pub next_ticket_to_process: u64,
    pub pending_ticket_count: u8,
}

#[event]
pub struct WithdrawProcessedEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub ticket: Pubkey,
    pub escrow_share_token_account: Pubkey,
    pub ticket_index: u64,
    pub shares_burned: u64,
    pub assets_out: u64,
    pub total_assets_after: u64,
    pub total_shares_after: u64,
    pub next_ticket_to_process: u64,
    pub pending_ticket_count: u8,
}

#[event]
pub struct ManagerWithdrawRequestedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub receiver_underlying_token_account: Pubkey,
    pub amount: u64,
    pub requested_slot: u64,
    pub executable_after_slot: u64,
}

#[event]
pub struct ManagerWithdrawExecutedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub executor: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub receiver_underlying_token_account: Pubkey,
    pub amount: u64,
    pub float_outstanding: u64,
    pub total_assets: u64,
}

#[event]
pub struct FloatValueReportedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub old_float_value: u64,
    pub new_float_value: u64,
    pub vault_underlying_balance: u64,
    pub total_assets: u64,
}

#[event]
pub struct ManagerDepositEvent {
    pub vault: Pubkey,
    pub caller: Pubkey,
    pub assets_in: u64,
    pub returned_float: u64,
    pub excess_amount: u64,
    pub float_outstanding: u64,
    pub total_assets: u64,
}

#[event]
pub struct ManagerNominatedEvent {
    pub vault: Pubkey,
    pub current_manager: Pubkey,
    pub pending_manager: Pubkey,
}

#[event]
pub struct ManagerAcceptedEvent {
    pub vault: Pubkey,
    pub old_manager: Pubkey,
    pub new_manager: Pubkey,
}
#[event]
pub struct ModuleRegisteredEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_entry: Pubkey,
    pub module_program_id: Pubkey,
    pub policy_seed: u64,
    pub module_count: u8,
}
#[event]
pub struct ModuleNavSyncedEvent {
    pub vault: Pubkey,
    pub cranker: Pubkey,
    pub module_entry: Pubkey,
    pub module_program_id: Pubkey,
    pub module_state: Pubkey,
    pub old_cached_nav: u64,
    pub new_cached_nav: u64,
    pub modules_nav_total: u64,
    pub slot: u64,
}


#[event]
pub struct ModuleCapitalDeployedEvent {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub module_entry: Pubkey,
    pub module_program_id: Pubkey,
    pub module_state: Pubkey,
    pub vault_token_account: Pubkey,
    pub module_token_account: Pubkey,
    pub amount: u64,
    pub deployed_value_after: u64,
}
