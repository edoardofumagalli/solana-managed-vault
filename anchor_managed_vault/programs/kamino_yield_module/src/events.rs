use anchor_lang::prelude::*;

#[event]
pub struct KaminoModuleDepositedEvent {
    pub vault: Pubkey,
    pub module_state: Pubkey,
    pub kamino_reserve: Pubkey,
    pub module_underlying_token_account: Pubkey,
    pub vault_collateral_account: Pubkey,
    pub amount: u64,
    pub cached_nav: u64,
    pub slot: u64,
}

#[event]
pub struct KaminoModuleWithdrawnEvent {
    pub vault: Pubkey,
    pub module_state: Pubkey,
    pub kamino_reserve: Pubkey,
    pub vault_collateral_account: Pubkey,
    pub vault_token_account: Pubkey,
    pub requested_amount: u64,
    pub collateral_amount: u64,
    pub returned_amount: u64,
    pub cached_nav: u64,
    pub slot: u64,
}
