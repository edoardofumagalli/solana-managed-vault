import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { DEFAULT_MAX_FLOAT_BPS, manager, program } from "./helpers/setup";
import {
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./helpers/pda";
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchTokenAccount,
    mintTokens,
} from "./helpers/token";
import { assertPublicKeyEquals } from "./helpers/assertions";

type VaultTestSetup = {
    underlyingMint: PublicKey;
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    depositorUnderlyingTokenAccount: PublicKey;
    depositorShareTokenAccount: PublicKey;
};

async function setupVault(
    depositAmount: number = 0,
    maxFloatBps: number = DEFAULT_MAX_FLOAT_BPS
): Promise<VaultTestSetup> {
    const underlyingMint = await createUnderlyingMint();

    const [vault] = deriveVaultPda(underlyingMint);
    const [shareMint] = deriveShareMintPda(vault);
    const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

    await program.methods
        .initializeVault(maxFloatBps)
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

    if (depositAmount > 0) {
        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            depositAmount
        );

        await program.methods
            .deposit(new anchor.BN(depositAmount))
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
        depositorUnderlyingTokenAccount,
        depositorShareTokenAccount,
    };
}

async function nominateManager(
    setup: VaultTestSetup,
    newManager: PublicKey,
    signer: Keypair | null = null,
    managerAccount: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .nominateManager(newManager)
        .accountsPartial({
            manager: managerAccount,
            vault: setup.vault,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
}

async function acceptManager(
    setup: VaultTestSetup,
    pendingManager: Keypair
): Promise<void> {
    await program.methods
        .acceptManager()
        .accountsPartial({
            pendingManager: pendingManager.publicKey,
            vault: setup.vault,
        })
        .signers([pendingManager])
        .rpc();
}

async function managerWithdraw(
    setup: VaultTestSetup,
    amount: number,
    receiverUnderlyingTokenAccount: PublicKey,
    signer: Keypair | null = null,
    managerAccount: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .managerWithdraw(new anchor.BN(amount))
        .accountsPartial({
            manager: managerAccount,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            receiverUnderlyingTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
}

describe("manager_update", () => {
    it("lets the current manager nominate a pending manager", async () => {
        const setup = await setupVault();
        const pendingManager = Keypair.generate();

        await nominateManager(setup, pendingManager.publicKey);

        const vaultState = await program.account.vault.fetch(setup.vault);

        assertPublicKeyEquals(vaultState.manager, manager, "manager mismatch");
        assertPublicKeyEquals(
            vaultState.pendingManager,
            pendingManager.publicKey,
            "pending manager mismatch"
        );
    });

    it("rejects nomination of the default public key", async () => {
        const setup = await setupVault();

        try {
            await nominateManager(setup, PublicKey.default);

            assert.fail("Expected nominate_manager to reject the default public key");
        } catch (error) {
            assert.include(String(error), "InvalidManager");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);

        assertPublicKeyEquals(vaultState.manager, manager, "manager mismatch");
        assertPublicKeyEquals(
            vaultState.pendingManager,
            PublicKey.default,
            "pending manager mismatch"
        );
    });

    it("rejects nomination by a non-manager", async () => {
        const setup = await setupVault();
        const unauthorizedManager = Keypair.generate();
        const pendingManager = Keypair.generate();

        try {
            await nominateManager(
                setup,
                pendingManager.publicKey,
                unauthorizedManager,
                unauthorizedManager.publicKey
            );

            assert.fail("Expected nominate_manager to reject unauthorized manager");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);

        assertPublicKeyEquals(vaultState.manager, manager, "manager mismatch");
        assertPublicKeyEquals(
            vaultState.pendingManager,
            PublicKey.default,
            "pending manager mismatch"
        );
    });

    it("rejects accept by an account that was not nominated", async () => {
        const setup = await setupVault();
        const pendingManager = Keypair.generate();
        const wrongPendingManager = Keypair.generate();

        await nominateManager(setup, pendingManager.publicKey);

        try {
            await acceptManager(setup, wrongPendingManager);

            assert.fail("Expected accept_manager to reject non-nominated manager");
        } catch (error) {
            assert.include(String(error), "InvalidPendingManager");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);

        assertPublicKeyEquals(vaultState.manager, manager, "manager mismatch");
        assertPublicKeyEquals(
            vaultState.pendingManager,
            pendingManager.publicKey,
            "pending manager mismatch"
        );
    });

    it("lets the nominated manager accept and clears pending_manager", async () => {
        const setup = await setupVault();
        const pendingManager = Keypair.generate();

        await nominateManager(setup, pendingManager.publicKey);
        await acceptManager(setup, pendingManager);

        const vaultState = await program.account.vault.fetch(setup.vault);

        assertPublicKeyEquals(
            vaultState.manager,
            pendingManager.publicKey,
            "manager mismatch"
        );
        assertPublicKeyEquals(
            vaultState.pendingManager,
            PublicKey.default,
            "pending manager mismatch"
        );
    });

    it("moves manager authority for manager_withdraw", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const setup = await setupVault(depositAmount);
        const pendingManager = Keypair.generate();
        const receiver = Keypair.generate();
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            receiver.publicKey
        );

        await nominateManager(setup, pendingManager.publicKey);
        await acceptManager(setup, pendingManager);

        try {
            await managerWithdraw(setup, withdrawAmount, receiverUnderlyingTokenAccount);

            assert.fail("Expected old manager to lose manager_withdraw authority");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }

        let receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        let vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        let vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(receiverUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.floatOutstanding.toString(), "0");

        await managerWithdraw(
            setup,
            withdrawAmount,
            receiverUnderlyingTokenAccount,
            pendingManager,
            pendingManager.publicKey
        );

        receiverUnderlying = await fetchTokenAccount(receiverUnderlyingTokenAccount);
        vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(receiverUnderlying.amount.toString(), withdrawAmount.toString());
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawAmount).toString()
        );
        assert.equal(vaultState.floatOutstanding.toString(), withdrawAmount.toString());
        assertPublicKeyEquals(
            vaultState.manager,
            pendingManager.publicKey,
            "manager mismatch"
        );
    });
});
