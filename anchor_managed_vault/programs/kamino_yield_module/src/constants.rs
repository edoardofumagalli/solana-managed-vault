use anchor_lang::prelude::*;

pub const MODULE_CONFIG_SEED: &[u8] = b"module_config";
pub const KAMINO_MODULE_STATE_SEED: &[u8] = b"kamino_module_state";

pub const MODULE_TYPE_TOKEN: u8 = 0;
pub const MODULE_TYPE_OBLIGATION: u8 = 1;

pub const KLEND_PROGRAM_ID: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
