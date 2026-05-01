use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub manager: Pubkey,
    pub pending_manager: Pubkey,
    pub underlying_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub float_outstanding: u64,
    pub max_float_bps: u16, // basis points
    pub total_tickets: u64,
    pub next_ticket_to_process: u64,
    pub bump: u8,
}
