use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct MockModuleState {
    // Standard module header. Keep this order stable.
    pub bump: u8,
    pub vault: Pubkey,
    pub cached_nav: u64,
    pub last_updated_slot: u64,

    // Mock-module-specific fields.
    pub underlying_mint: Pubkey,
    pub module_token_account: Pubkey,
    pub module_authority_bump: u8,
    pub is_initialized: bool,
}
