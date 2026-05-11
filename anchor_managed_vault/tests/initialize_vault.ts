import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
    DEFAULT_MAX_FLOAT_BPS,
    DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
    INVALID_MAX_FLOAT_BPS,
    INVALID_MANAGER_WITHDRAW_DELAY_SLOTS,
    manager,
    program,
} from "./helpers/setup";
import {
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./helpers/pda";
import {
    DEFAULT_DECIMALS,
    createUnderlyingMint,
    fetchMint,
    fetchTokenAccount,
} from "./helpers/token";
import { assertPublicKeyEquals } from "./helpers/assertions";

describe("initialize_vault", () => {
    it("initializes vault state, share mint, and vault token account", async () => {
        const underlyingMint = await createUnderlyingMint();
        const emergencyAdmin = Keypair.generate().publicKey;

        const [vault, vaultBump] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        await program.methods
            .initializeVault(DEFAULT_MAX_FLOAT_BPS, emergencyAdmin, DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS)
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

        const vaultState = await program.account.vault.fetch(vault);

        assertPublicKeyEquals(vaultState.manager, manager, "manager mismatch");
        assertPublicKeyEquals(
            vaultState.pendingManager,
            PublicKey.default,
            "pending manager mismatch"
        );
        assertPublicKeyEquals(
            vaultState.emergencyAdmin,
            emergencyAdmin,
            "emergency admin mismatch"
        );
        assertPublicKeyEquals(
            vaultState.underlyingMint,
            underlyingMint,
            "underlying mint mismatch"
        );
        assertPublicKeyEquals(
            vaultState.shareMint,
            shareMint,
            "share mint mismatch"
        );
        assertPublicKeyEquals(
            vaultState.vaultTokenAccount,
            vaultTokenAccount,
            "vault token account mismatch"
        );

        assert.equal(vaultState.floatOutstanding.toNumber(), 0);
        assert.equal(vaultState.maxFloatBps, DEFAULT_MAX_FLOAT_BPS);
        assert.equal(
            vaultState.managerWithdrawDelaySlots.toNumber(),
            DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS.toNumber()
        );
        assert.equal(vaultState.isShutdown, false);
        assert.equal(vaultState.shutdownSlot.toNumber(), 0);
        assert.equal(vaultState.totalTickets.toNumber(), 0);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 0);
        assert.equal(vaultState.nextManagerWithdrawRequestId.toNumber(), 0);
        assert.equal(vaultState.bump, vaultBump);

        const shareMintAccount = await fetchMint(shareMint);

        assert.equal(shareMintAccount.decimals, DEFAULT_DECIMALS);
        assertPublicKeyEquals(
            shareMintAccount.mintAuthority,
            vault,
            "share mint authority mismatch"
        );
        assert.equal(shareMintAccount.supply.toString(), "0");

        const vaultTokenAccountInfo = await fetchTokenAccount(vaultTokenAccount);

        assertPublicKeyEquals(
            vaultTokenAccountInfo.mint,
            underlyingMint,
            "vault token account mint mismatch"
        );
        assertPublicKeyEquals(
            vaultTokenAccountInfo.owner,
            vault,
            "vault token account owner mismatch"
        );
        assert.equal(vaultTokenAccountInfo.amount.toString(), "0");
    });

    it("rejects max_float_bps above 100%", async () => {
        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        try {
            await program.methods
                .initializeVault(INVALID_MAX_FLOAT_BPS, manager, DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS)
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

            assert.fail("Expected initializeVault to reject invalid max_float_bps");
        } catch (error) {
            assert.include(String(error), "InvalidMaxFloatBps");
        }
    });

    it("rejects the default public key as emergency admin", async () => {
        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        try {
            await program.methods
                .initializeVault(DEFAULT_MAX_FLOAT_BPS, PublicKey.default, DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS)
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

            assert.fail("Expected initializeVault to reject invalid emergency admin");
        } catch (error) {
            assert.include(String(error), "InvalidEmergencyAdmin");
        }
    });
    it("rejects manager withdraw delay above the allowed maximum", async () => {
        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        try {
            await program.methods
                .initializeVault(
                    DEFAULT_MAX_FLOAT_BPS,
                    manager,
                    INVALID_MANAGER_WITHDRAW_DELAY_SLOTS
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

            assert.fail("Expected initializeVault to reject invalid manager withdraw delay");
        } catch (error) {
            assert.include(String(error), "InvalidManagerWithdrawDelay");
        }
    });
});
