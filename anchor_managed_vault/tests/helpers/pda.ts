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
const MANAGER_WITHDRAW_REQUEST_SEED = Buffer.from("manager_withdraw_request");
const MODULE_ENTRY_SEED = Buffer.from("module_entry");
const MODULE_CALL_AUTHORITY_SEED = Buffer.from("module_call_authority");
const MOCK_MODULE_STATE_SEED = Buffer.from("mock_module_state");
const MOCK_MODULE_AUTHORITY_SEED = Buffer.from("mock_module_authority");
const KAMINO_MODULE_CONFIG_SEED = Buffer.from("module_config");
const KAMINO_MODULE_STATE_SEED = Buffer.from("kamino_module_state");

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

// Derives a pending manager withdrawal request PDA for a specific request id.
// Like ticket indexes, the request id is a Rust u64, so it must be encoded as
// exactly 8 little-endian bytes on the client.
export function deriveManagerWithdrawRequestPda(
    vault: PublicKey,
    requestId: number | anchor.BN
): [PublicKey, number] {
    const requestIdSeed = new anchor.BN(requestId).toArrayLike(
        Buffer,
        "le",
        8
    );

    return PublicKey.findProgramAddressSync(
        [MANAGER_WITHDRAW_REQUEST_SEED, vault.toBuffer(), requestIdSeed],
        program.programId
    );
}

// Derives the per-module policy entry tracked by the vault program.
// policySeed mirrors Rust u64::to_le_bytes() and allows the same external
// module program to register multiple strategies for the same vault.
export function deriveModuleEntryPda(
    vault: PublicKey,
    moduleProgramId: PublicKey,
    policySeed: number | anchor.BN
): [PublicKey, number] {
    const policySeedBytes = new anchor.BN(policySeed).toArrayLike(
        Buffer,
        "le",
        8
    );

    return PublicKey.findProgramAddressSync(
        [
            MODULE_ENTRY_SEED,
            vault.toBuffer(),
            moduleProgramId.toBuffer(),
            policySeedBytes,
        ],
        program.programId
    );
}

// Derives the non-custodial PDA used only to authenticate vault-initiated
// CPIs into external modules. This PDA must not own vault funds or mint authority.
export function deriveModuleCallAuthorityPda(
    vault: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MODULE_CALL_AUTHORITY_SEED, vault.toBuffer()],
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


// Derives the mock module state PDA. This PDA belongs to the mock_yield_module
// program, not to the vault program, so the module program id is passed in.
export function deriveMockModuleStatePda(
    vault: PublicKey,
    mockYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MOCK_MODULE_STATE_SEED, vault.toBuffer()],
        mockYieldModuleProgramId
    );
}

// Derives the PDA that owns the mock module token account. The mock module uses
// this PDA as signer when it later returns funds to the vault.
export function deriveMockModuleAuthorityPda(
    mockModuleState: PublicKey,
    mockYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MOCK_MODULE_AUTHORITY_SEED, mockModuleState.toBuffer()],
        mockYieldModuleProgramId
    );
}

// Derives the Kamino module config PDA. This PDA belongs to the
// kamino_yield_module program, not to the vault program.
export function deriveKaminoModuleConfigPda(
    vault: PublicKey,
    kaminoYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [KAMINO_MODULE_CONFIG_SEED, vault.toBuffer()],
        kaminoYieldModuleProgramId
    );
}

// Derives the Kamino module state PDA containing the standardized NAV header
// read by the vault's sync_module_nav instruction.
export function deriveKaminoModuleStatePda(
    vault: PublicKey,
    kaminoYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [KAMINO_MODULE_STATE_SEED, vault.toBuffer()],
        kaminoYieldModuleProgramId
    );
}
