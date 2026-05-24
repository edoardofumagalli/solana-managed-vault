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
