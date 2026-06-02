import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
    DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
    DEFAULT_MAX_FLOAT_BPS,
    manager,
    program,
} from "./setup";
import {
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./pda";
import { createTokenAccount, createUnderlyingMint, mintTokens } from "./token";

export type VaultSetup = {
    underlyingMint: PublicKey;
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    emergencyAdmin: PublicKey;
};

export type VaultUserSetup = {
    user: PublicKey;
    userSigner: Keypair | null;
    userUnderlyingTokenAccount: PublicKey;
    userShareTokenAccount: PublicKey;
};

export type VaultWithUserSetup = VaultSetup & VaultUserSetup;

export type SetupVaultOptions = {
    underlyingMint?: PublicKey;
    maxFloatBps?: number;
    emergencyAdmin?: PublicKey;
    managerWithdrawDelaySlots?: anchor.BN;
};

export type CreateVaultUserOptions = {
    user?: PublicKey;
    userSigner?: Keypair | null;
    initialUnderlyingAmount?: number | bigint;
};

type DepositIntoVaultOptions = {
    depositor?: PublicKey;
    depositorSigner?: Keypair | null;
    depositorUnderlyingTokenAccount: PublicKey;
    depositorShareTokenAccount: PublicKey;
    amount: number | bigint;
};

export async function setupVault(
    options: SetupVaultOptions = {}
): Promise<VaultSetup> {
    const underlyingMint = options.underlyingMint ?? await createUnderlyingMint();
    const [vault] = deriveVaultPda(underlyingMint);
    const [shareMint] = deriveShareMintPda(vault);
    const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);
    const emergencyAdmin = options.emergencyAdmin ?? manager;

    await program.methods
        .initializeVault(
            options.maxFloatBps ?? DEFAULT_MAX_FLOAT_BPS,
            emergencyAdmin,
            options.managerWithdrawDelaySlots ?? DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS
        )
        .accountsPartial({
            manager,
            underlyingMint,
            vault,
            shareMint,
            vaultTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

    return {
        underlyingMint,
        vault,
        shareMint,
        vaultTokenAccount,
        emergencyAdmin,
    };
}

export async function createVaultUser(
    setup: VaultSetup,
    options: CreateVaultUserOptions = {}
): Promise<VaultUserSetup> {
    const user = options.user ?? manager;
    const userUnderlyingTokenAccount = await createTokenAccount(
        setup.underlyingMint,
        user
    );
    const userShareTokenAccount = await createTokenAccount(setup.shareMint, user);

    if (
        options.initialUnderlyingAmount &&
        BigInt(options.initialUnderlyingAmount) > BigInt(0)
    ) {
        await mintTokens(
            setup.underlyingMint,
            userUnderlyingTokenAccount,
            options.initialUnderlyingAmount
        );
    }

    return {
        user,
        userSigner: options.userSigner ?? null,
        userUnderlyingTokenAccount,
        userShareTokenAccount,
    };
}

export async function depositIntoVault(
    setup: VaultSetup,
    options: DepositIntoVaultOptions
): Promise<void> {
    const builder = program.methods
        .deposit(new anchor.BN(options.amount.toString()))
        .accountsPartial({
            depositor: options.depositor ?? manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            depositorUnderlyingTokenAccount: options.depositorUnderlyingTokenAccount,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            depositorShareTokenAccount: options.depositorShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (options.depositorSigner) {
        await builder.signers([options.depositorSigner]).rpc();
        return;
    }

    await builder.rpc();
}

export async function setupVaultWithDeposit(
    depositAmount: number | bigint,
    optionsOrMaxFloatBps: (SetupVaultOptions & CreateVaultUserOptions) | number = {},
    managerWithdrawDelaySlots?: anchor.BN
): Promise<VaultWithUserSetup> {
    const options = typeof optionsOrMaxFloatBps === "number"
        ? {
            maxFloatBps: optionsOrMaxFloatBps,
            managerWithdrawDelaySlots,
        }
        : optionsOrMaxFloatBps;
    const setup = await setupVault(options);
    const user = await createVaultUser(setup, {
        user: options.user,
        userSigner: options.userSigner,
        initialUnderlyingAmount: depositAmount,
    });

    await depositIntoVault(setup, {
        depositor: user.user,
        depositorSigner: user.userSigner,
        depositorUnderlyingTokenAccount: user.userUnderlyingTokenAccount,
        depositorShareTokenAccount: user.userShareTokenAccount,
        amount: depositAmount,
    });

    return {
        ...setup,
        ...user,
    };
}
