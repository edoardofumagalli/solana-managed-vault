use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ModuleEntry {
    pub vault: Pubkey,
    pub module_program_id: Pubkey,
    pub policy_seed: u64,
    pub cached_nav: u64,
    pub nav_last_updated_slot: u64,
    pub is_active: bool,
    pub bump: u8,
}
