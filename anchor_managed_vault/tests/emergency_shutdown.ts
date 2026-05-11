import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
    DEFAULT_MAX_FLOAT_BPS,
    DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
    manager,
    program,
} from "./helpers/setup";
import {
    deriveManagerWithdrawRequestPda,
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./helpers/pda";
import {
    createTokenAccount,
    createUnderlyingMint,
    mintTokens,
} from "./helpers/token";
import { assertPublicKeyEquals } from "./helpers/assertions";

type VaultTestSetup = {
    underlyingMint: PublicKey;
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    emergencyAdmin: Keypair;
    depositorUnderlyingTokenAccount: PublicKey;
    depositorShareTokenAccount: PublicKey;
};

async function setupVault(
    initialDepositAmount: number = 0
): Promise<VaultTestSetup> {
    const underlyingMint = await createUnderlyingMint();
    const emergencyAdmin = Keypair.generate();

    const [vault] = deriveVaultPda(underlyingMint);
    const [shareMint] = deriveShareMintPda(vault);
    const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

    await program.methods
        .initializeVault(DEFAULT_MAX_FLOAT_BPS, emergencyAdmin.publicKey, DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS)
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

    const depositorUnderlyingTokenAccount = await createTokenAccount(
        underlyingMint,
        manager
    );
    const depositorShareTokenAccount = await createTokenAccount(
        shareMint,
        manager
    );

    if (initialDepositAmount > 0) {
        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            initialDepositAmount
        );

        await program.methods
            .deposit(new anchor.BN(initialDepositAmount))
            .accountsPartial({
                depositor: manager,
                vault,
                underlyingMint,
                depositorUnderlyingTokenAccount,
                shareMint,
                vaultTokenAccount,
                depositorShareTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();
    }

    return {
        underlyingMint,
        vault,
        shareMint,
        vaultTokenAccount,
        emergencyAdmin,
        depositorUnderlyingTokenAccount,
        depositorShareTokenAccount,
    };
}

async function activateEmergencyShutdown(setup: VaultTestSetup): Promise<void> {
    await program.methods
        .activateEmergencyShutdown()
        .accountsPartial({
            emergencyAdmin: setup.emergencyAdmin.publicKey,
            vault: setup.vault,
        })
        .signers([setup.emergencyAdmin])
        .rpc();
}

async function requestManagerWithdraw(
    setup: VaultTestSetup,
    amount: number,
    receiverUnderlyingTokenAccount: PublicKey
): Promise<PublicKey> {
    const vaultState = await program.account.vault.fetch(setup.vault);
    const [managerWithdrawRequest] = deriveManagerWithdrawRequestPda(
        setup.vault,
        vaultState.nextManagerWithdrawRequestId
    );

    await program.methods
        .requestManagerWithdraw(new anchor.BN(amount))
        .accountsPartial({
            manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            receiverUnderlyingTokenAccount,
            managerWithdrawRequest,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    return managerWithdrawRequest;
}

describe("emergency_shutdown", () => {
    it("lets the emergency admin activate shutdown", async () => {
        const setup = await setupVault();

        await activateEmergencyShutdown(setup);

        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isTrue(vaultState.isShutdown);
        assert.isTrue(vaultState.shutdownSlot.gt(new anchor.BN(0)));
        assertPublicKeyEquals(
            vaultState.emergencyAdmin,
            setup.emergencyAdmin.publicKey,
            "emergency admin mismatch"
        );
    });

    it("rejects shutdown activation from a non-admin", async () => {
        const setup = await setupVault();
        const nonAdmin = Keypair.generate();

        try {
            await program.methods
                .activateEmergencyShutdown()
                .accountsPartial({
                    emergencyAdmin: nonAdmin.publicKey,
                    vault: setup.vault,
                })
                .signers([nonAdmin])
                .rpc();

            assert.fail("Expected activateEmergencyShutdown to reject non-admin");
        } catch (error) {
            assert.include(String(error), "UnauthorizedEmergencyAdmin");
        }
    });

    it("rejects activating shutdown twice", async () => {
        const setup = await setupVault();

        await activateEmergencyShutdown(setup);

        try {
            await program.methods
                .activateEmergencyShutdown()
                .accountsPartial({
                    emergencyAdmin: setup.emergencyAdmin.publicKey,
                    vault: setup.vault,
                })
                .signers([setup.emergencyAdmin])
                .rpc();

            assert.fail("Expected activateEmergencyShutdown to reject double activation");
        } catch (error) {
            assert.include(String(error), "ShutdownAlreadyActive");
        }
    });

    it("blocks deposits after shutdown", async () => {
        const setup = await setupVault();
        const depositAmount = 100_000;

        await mintTokens(
            setup.underlyingMint,
            setup.depositorUnderlyingTokenAccount,
            depositAmount
        );
        await activateEmergencyShutdown(setup);

        try {
            await program.methods
                .deposit(new anchor.BN(depositAmount))
                .accountsPartial({
                    depositor: manager,
                    vault: setup.vault,
                    underlyingMint: setup.underlyingMint,
                    depositorUnderlyingTokenAccount:
                        setup.depositorUnderlyingTokenAccount,
                    shareMint: setup.shareMint,
                    vaultTokenAccount: setup.vaultTokenAccount,
                    depositorShareTokenAccount: setup.depositorShareTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            assert.fail("Expected deposit to fail after shutdown");
        } catch (error) {
            assert.include(String(error), "VaultShutdown");
        }
    });

    it("blocks manager withdrawal requests after shutdown", async () => {
        const setup = await setupVault(1_000_000);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        await activateEmergencyShutdown(setup);

        try {
            await requestManagerWithdraw(
                setup,
                100_000,
                receiverUnderlyingTokenAccount
            );

            assert.fail("Expected request_manager_withdraw to fail after shutdown");
        } catch (error) {
            assert.include(String(error), "VaultShutdown");
        }
    });
});
