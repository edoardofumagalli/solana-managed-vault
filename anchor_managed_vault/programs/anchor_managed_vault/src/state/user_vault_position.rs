use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserVaultPosition {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub pending_ticket_count: u8,
    pub bump: u8,
}
