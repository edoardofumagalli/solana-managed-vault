use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use solana_sdk::{
    hash::Hash,
    instruction::Instruction,
    message::{v0::Message, VersionedMessage},
    pubkey::Pubkey,
    signature::Signature,
    transaction::VersionedTransaction,
};

use crate::api::ApiError;

#[derive(Debug)]
pub struct UnsignedTransaction {
    pub transaction: VersionedTransaction,
    pub transaction_base64: String,
    pub required_signers: Vec<Pubkey>,
    pub fee_payer: Pubkey,
    pub recent_blockhash: Hash,
}

pub fn build_unsigned_transaction(
    fee_payer: Pubkey,
    instructions: &[Instruction],
    required_signers: Vec<Pubkey>,
    recent_blockhash: Hash,
) -> Result<UnsignedTransaction, ApiError> {
    let message =
        Message::try_compile(&fee_payer, instructions, &[], recent_blockhash).map_err(|error| {
            ApiError::transaction_compile_failed(format!("failed to compile transaction: {error}"))
        })?;

    let signature_count = usize::from(message.header.num_required_signatures);
    let transaction = VersionedTransaction {
        signatures: vec![Signature::default(); signature_count],
        message: VersionedMessage::V0(message),
    };

    let transaction_bytes = bincode::serialize(&transaction).map_err(|error| {
        ApiError::transaction_serialization_failed(format!(
            "failed to serialize transaction: {error}"
        ))
    })?;

    Ok(UnsignedTransaction {
        transaction,
        transaction_base64: BASE64_STANDARD.encode(transaction_bytes),
        required_signers,
        fee_payer,
        recent_blockhash,
    })
}

pub fn build_user_wallet_transaction(
    user_wallet: Pubkey,
    instructions: &[Instruction],
    recent_blockhash: Hash,
) -> Result<UnsignedTransaction, ApiError> {
    build_unsigned_transaction(
        user_wallet,
        instructions,
        vec![user_wallet],
        recent_blockhash,
    )
}

/// Builds a transaction for permissionless instructions where the client only
/// needs to sign as the fee payer.
#[allow(dead_code)]
pub fn build_permissionless_transaction(
    fee_payer: Pubkey,
    instructions: &[Instruction],
    recent_blockhash: Hash,
) -> Result<UnsignedTransaction, ApiError> {
    build_unsigned_transaction(fee_payer, instructions, vec![fee_payer], recent_blockhash)
}
