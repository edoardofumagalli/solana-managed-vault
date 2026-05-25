use anchor_lang::prelude::*;

#[event]
pub struct MockModuleInitializedEvent {
    pub vault: Pubkey,
    pub module_state: Pubkey,
    pub module_token_account: Pubkey,
    pub underlying_mint: Pubkey,
}

#[event]
pub struct MockModuleNavCalculatedEvent {
    pub vault: Pubkey,
    pub module_state: Pubkey,
    pub cached_nav: u64,
    pub slot: u64,
}

#[event]
pub struct MockModuleDepositedEvent {
    pub vault: Pubkey,
    pub module_state: Pubkey,
    pub module_token_account: Pubkey,
    pub amount: u64,
    pub cached_nav: u64,
    pub slot: u64,
}

#[event]
pub struct MockModuleCapitalReturnedEvent {
    pub vault: Pubkey,
    pub module_state: Pubkey,
    pub vault_token_account: Pubkey,
    pub module_token_account: Pubkey,
    pub amount: u64,
    pub cached_nav: u64,
    pub slot: u64,
}

#[event]
pub struct MockModuleWithdrawnEvent {
    pub vault: Pubkey,
    pub module_state: Pubkey,
    pub vault_token_account: Pubkey,
    pub module_token_account: Pubkey,
    pub amount: u64,
    pub cached_nav: u64,
    pub slot: u64,
}
