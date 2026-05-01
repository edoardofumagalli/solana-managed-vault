use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct WithdrawTicket {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub escrow_share_token_account: Pubkey,
    pub ticket_index: u64,
    pub shares: u64,
    pub requested_slot: u64,
    pub bump: u8,
}
