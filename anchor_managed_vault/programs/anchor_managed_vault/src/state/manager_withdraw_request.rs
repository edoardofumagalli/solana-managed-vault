use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ManagerWithdrawRequest {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub receiver_underlying_token_account: Pubkey,
    pub request_id: u64,
    pub amount: u64,
    pub requested_slot: u64,
    pub executable_after_slot: u64,
    pub bump: u8,
}
