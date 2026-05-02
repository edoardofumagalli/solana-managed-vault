import { assert } from "chai";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
    DEFAULT_MAX_FLOAT_BPS,
    INVALID_MAX_FLOAT_BPS,
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

        const [vault, vaultBump] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        await program.methods
            .initializeVault(DEFAULT_MAX_FLOAT_BPS)
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
        assert.equal(vaultState.totalTickets.toNumber(), 0);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 0);
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
                .initializeVault(INVALID_MAX_FLOAT_BPS)
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
});
