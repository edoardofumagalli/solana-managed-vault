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

async function setupVaultWithDeposit(
    depositAmount: number,
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

    return {
        underlyingMint,
        vault,
        shareMint,
        vaultTokenAccount,
        depositorUnderlyingTokenAccount,
        depositorShareTokenAccount,
    };
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

describe("manager_withdraw", () => {
    it("lets the manager withdraw within the float cap to a generic receiver", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 200_000;
        const receiver = Keypair.generate();

        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            receiver.publicKey
        );

        await managerWithdraw(setup, withdrawAmount, receiverUnderlyingTokenAccount);

        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(receiverUnderlying.amount.toString(), withdrawAmount.toString());
        assertPublicKeyEquals(
            receiverUnderlying.owner,
            receiver.publicKey,
            "receiver token account owner mismatch"
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawAmount).toString()
        );
        assert.equal(
            vaultState.floatOutstanding.toString(),
            withdrawAmount.toString()
        );
    });

    it("rejects zero amount", async () => {
        const depositAmount = 1_000;

        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await managerWithdraw(setup, 0, receiverUnderlyingTokenAccount);

            assert.fail("Expected manager_withdraw to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }

        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(receiverUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("rejects withdraws above the float cap", async () => {
        const depositAmount = 1_000_000;
        const overCapAmount = 200_001;

        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await managerWithdraw(setup, overCapAmount, receiverUnderlyingTokenAccount);

            assert.fail("Expected manager_withdraw to enforce the float cap");
        } catch (error) {
            assert.include(String(error), "FloatCapExceeded");
        }

        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(receiverUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("rejects unauthorized managers", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const unauthorizedManager = Keypair.generate();

        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            unauthorizedManager.publicKey
        );

        try {
            await managerWithdraw(
                setup,
                withdrawAmount,
                receiverUnderlyingTokenAccount,
                unauthorizedManager,
                unauthorizedManager.publicKey
            );

            assert.fail("Expected manager_withdraw to reject unauthorized manager");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }

        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(receiverUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("rejects withdraws above vault liquidity", async () => {
        const depositAmount = 1_000;
        const withdrawAmount = depositAmount + 1;

        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await managerWithdraw(setup, withdrawAmount, receiverUnderlyingTokenAccount);

            assert.fail("Expected manager_withdraw to reject insufficient liquidity");
        } catch (error) {
            assert.include(String(error), "InsufficientLiquidity");
        }

        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(receiverUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });
});
