use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ModuleConfig {
    pub bump: u8,
    pub vault: Pubkey,
    pub vault_program_id: Pubkey,
    pub lending_market: Pubkey,
    pub kamino_reserve: Pubkey,
    pub module_type: u8,
    pub obligation: Pubkey,
}
