import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
    KAMINO_MODULE_CONFIG_SEED,
    KAMINO_MODULE_STATE_SEED,
    KAMINO_USDC,
    MOCK_MODULE_AUTHORITY_SEED,
    MOCK_MODULE_STATE_SEED,
    MODULE_CALL_AUTHORITY_SEED,
    MODULE_ENTRY_SEED,
    SHARE_MINT_SEED,
    USER_VAULT_POSITION_SEED,
    VAULT_SEED,
} from "./constants";
import { KaminoUsdcDerivedAccounts } from "./types";

export function deriveVaultPda(
    programId: PublicKey,
    underlyingMint: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [VAULT_SEED, underlyingMint.toBuffer()],
        programId
    );
}

export function deriveShareMintPda(
    programId: PublicKey,
    vault: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SHARE_MINT_SEED, vault.toBuffer()],
        programId
    );
}

export function deriveUserVaultPositionPda(
    programId: PublicKey,
    vault: PublicKey,
    user: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [USER_VAULT_POSITION_SEED, vault.toBuffer(), user.toBuffer()],
        programId
    );
}

export function deriveModuleEntryPda(
    programId: PublicKey,
    vault: PublicKey,
    moduleProgramId: PublicKey,
    policySeed: string
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
        programId
    );
}

export function deriveModuleCallAuthorityPda(
    programId: PublicKey,
    vault: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MODULE_CALL_AUTHORITY_SEED, vault.toBuffer()],
        programId
    );
}

export function deriveMockModuleStatePda(
    vault: PublicKey,
    mockYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MOCK_MODULE_STATE_SEED, vault.toBuffer()],
        mockYieldModuleProgramId
    );
}

export function deriveMockModuleAuthorityPda(
    mockModuleState: PublicKey,
    mockYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MOCK_MODULE_AUTHORITY_SEED, mockModuleState.toBuffer()],
        mockYieldModuleProgramId
    );
}

export function deriveKaminoModuleConfigPda(
    vault: PublicKey,
    kaminoYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [KAMINO_MODULE_CONFIG_SEED, vault.toBuffer()],
        kaminoYieldModuleProgramId
    );
}

export function deriveKaminoModuleStatePda(
    vault: PublicKey,
    kaminoYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [KAMINO_MODULE_STATE_SEED, vault.toBuffer()],
        kaminoYieldModuleProgramId
    );
}

export function deriveKaminoUsdcAccounts(params: {
    vaultProgramId: PublicKey;
    kaminoYieldModuleProgramId: PublicKey;
    policySeed: string;
}): KaminoUsdcDerivedAccounts {
    const [vault] = deriveVaultPda(
        params.vaultProgramId,
        KAMINO_USDC.liquidityMint
    );
    const [shareMint] = deriveShareMintPda(params.vaultProgramId, vault);
    const [moduleCallAuthority] = deriveModuleCallAuthorityPda(
        params.vaultProgramId,
        vault
    );
    const [moduleEntry] = deriveModuleEntryPda(
        params.vaultProgramId,
        vault,
        params.kaminoYieldModuleProgramId,
        params.policySeed
    );
    const [moduleConfig] = deriveKaminoModuleConfigPda(
        vault,
        params.kaminoYieldModuleProgramId
    );
    const [moduleState] = deriveKaminoModuleStatePda(
        vault,
        params.kaminoYieldModuleProgramId
    );
    const vaultTokenAccount = getAssociatedTokenAddressSync(
        KAMINO_USDC.liquidityMint,
        vault,
        true,
        TOKEN_PROGRAM_ID
    );
    const moduleUnderlyingTokenAccount = getAssociatedTokenAddressSync(
        KAMINO_USDC.liquidityMint,
        moduleState,
        true,
        TOKEN_PROGRAM_ID
    );
    const vaultCollateralAccount = getAssociatedTokenAddressSync(
        KAMINO_USDC.collateralMint,
        moduleState,
        true,
        TOKEN_PROGRAM_ID
    );

    return {
        vault,
        shareMint,
        vaultTokenAccount,
        moduleCallAuthority,
        moduleEntry,
        moduleConfig,
        moduleState,
        moduleUnderlyingTokenAccount,
        vaultCollateralAccount,
    };
}
