import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { program } from "./setup";

// These seed strings must mirror the Rust constants used by the on-chain program.
// PDA derivation must match exactly on both client and program side.
const VAULT_SEED = Buffer.from("vault");
const SHARE_MINT_SEED = Buffer.from("share_mint");
const WITHDRAW_TICKET_SEED = Buffer.from("withdraw_ticket");
const USER_VAULT_POSITION_SEED = Buffer.from("user_vault_position");
const ESCROW_SHARE_SEED = Buffer.from("escrow_share");

// Derives the main vault state PDA for a given underlying mint.
// A PDA depends on both its seeds and the program id, so the same seeds under a
// different program would produce a different address.
export function deriveVaultPda(underlyingMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [VAULT_SEED, underlyingMint.toBuffer()],
        program.programId
    );
}

// Derives the SPL mint address used for vault shares.
// This is a PDA too, and the vault PDA is configured as its mint authority.
export function deriveShareMintPda(vault: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SHARE_MINT_SEED, vault.toBuffer()],
        program.programId
    );
}

// Derives the vault's associated token account for the underlying mint.
// An ATA is determined by mint + owner + token program. Here the owner is the
// vault PDA, so allowOwnerOffCurve must be true because PDAs are off-curve.
// TOKEN_PROGRAM_ID is the classic SPL Token program; it can be overridden for
// Token-2022 tests if needed later.
export function deriveVaultTokenAccount(
    underlyingMint: PublicKey,
    vault: PublicKey,
    tokenProgramId: PublicKey = TOKEN_PROGRAM_ID
): PublicKey {
    return getAssociatedTokenAddressSync(
        underlyingMint,
        vault,
        true,
        tokenProgramId
    );
}

// Derives the per-user vault position account used to track pending tickets.
// The account is unique for a user inside a specific vault.
export function deriveUserVaultPositionPda(
    vault: PublicKey,
    user: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [USER_VAULT_POSITION_SEED, vault.toBuffer(), user.toBuffer()],
        program.programId
    );
}

// Derives a withdrawal ticket PDA for a specific queue index.
// Rust uses u64::to_le_bytes(), so the client must pass the index as exactly
// 8 little-endian bytes to match the on-chain PDA derivation.
export function deriveWithdrawTicketPda(
    vault: PublicKey,
    user: PublicKey,
    ticketIndex: number | anchor.BN
): [PublicKey, number] {
    const ticketIndexSeed = new anchor.BN(ticketIndex).toArrayLike(
        Buffer,
        "le",
        8
    );

    return PublicKey.findProgramAddressSync(
        [
            WITHDRAW_TICKET_SEED,
            vault.toBuffer(),
            user.toBuffer(),
            ticketIndexSeed,
        ],
        program.programId
    );
}

// Derives the token account PDA that escrows shares while a withdrawal ticket is pending.
// The escrow account authority is the withdraw ticket PDA, not the user.
export function deriveEscrowShareTokenAccountPda(
    withdrawTicket: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [ESCROW_SHARE_SEED, withdrawTicket.toBuffer()],
        program.programId
    );
}

