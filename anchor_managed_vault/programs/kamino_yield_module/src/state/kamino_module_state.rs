use anchor_lang::prelude::*;

use crate::constants::{MODULE_TYPE_OBLIGATION, MODULE_TYPE_TOKEN};
use crate::errors::KaminoYieldModuleError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum KaminoModuleType {
    Token = MODULE_TYPE_TOKEN,
    Obligation = MODULE_TYPE_OBLIGATION,
}

#[account]
#[derive(InitSpace)]
pub struct KaminoModuleState {
    // Standard module header. Keep this order stable for vault sync_module_nav.
    pub bump: u8,
    pub vault: Pubkey,
    pub cached_nav: u64,
    pub last_updated_slot: u64,

    // Kamino-specific fields.
    pub kamino_reserve: Pubkey,
    pub lending_market: Pubkey,
    pub module_type: u8,
    pub obligation: Pubkey,
    pub is_initialized: bool,
}

impl KaminoModuleState {
    pub fn kamino_module_type(&self) -> Result<KaminoModuleType> {
        match self.module_type {
            MODULE_TYPE_TOKEN => Ok(KaminoModuleType::Token),
            MODULE_TYPE_OBLIGATION => Ok(KaminoModuleType::Obligation),
            _ => Err(KaminoYieldModuleError::InvalidModuleType.into()),
        }
    }
}
