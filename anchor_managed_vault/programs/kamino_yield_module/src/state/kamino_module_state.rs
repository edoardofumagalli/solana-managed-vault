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

    // Module-authentication fields.
    // Used to verify that module_call_authority is derived by the expected vault program.
    pub vault_program_id: Pubkey,

    // Kamino-specific fields.
    // Reserve is the concrete Kamino lending pool this module tracks, e.g. a USDC reserve.
    pub kamino_reserve: Pubkey,
    // Lending market groups reserves under one Kamino market configuration and authority model.
    pub lending_market: Pubkey,
    // Selects how the position is represented: collateral token balance or obligation state.
    pub module_type: u8,
    // Obligation stores deposited collateral for obligation-based Kamino positions.
    pub obligation: Pubkey,
    // Marks that initialize ran successfully and the state can be used by calculate_nav.
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
