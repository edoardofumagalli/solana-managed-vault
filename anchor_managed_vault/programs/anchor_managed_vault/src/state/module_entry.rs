use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ModuleEntry {
    pub vault: Pubkey,
    pub module_program_id: Pubkey,
    pub policy_seed: u64,
    pub module_state: Pubkey,
    pub module_underlying_token_account: Pubkey,
    pub cached_nav: u64,
    pub nav_last_updated_slot: u64,
    pub is_active: bool,
    pub bump: u8,
}
