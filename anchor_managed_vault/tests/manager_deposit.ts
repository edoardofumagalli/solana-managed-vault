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
    receiverUnderlyingTokenAccount: PublicKey
): Promise<void> {
    await program.methods
        .managerWithdraw(new anchor.BN(amount))
        .accountsPartial({
            manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            receiverUnderlyingTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
}

async function managerDeposit(
    setup: VaultTestSetup,
    amount: number,
    callerUnderlyingTokenAccount: PublicKey,
    signer: Keypair | null = null,
    caller: PublicKey = manager,
    vaultTokenAccount: PublicKey = setup.vaultTokenAccount,
    underlyingMint: PublicKey = setup.underlyingMint
): Promise<void> {
    const builder = program.methods
        .managerDeposit(new anchor.BN(amount))
        .accountsPartial({
            caller,
            vault: setup.vault,
            underlyingMint,
            callerUnderlyingTokenAccount,
            vaultTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
}

function assertErrorIncludesAny(error: unknown, expectedParts: string[]) {
    const message = String(error);
    assert.isTrue(
        expectedParts.some((part) => message.includes(part)),
        `Expected error to include one of ${expectedParts.join(", ")}, got: ${message}`
    );
}

describe("manager_deposit", () => {
    it("lets a non-manager return underlying and reduce outstanding float", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 200_000;
        const returnAmount = 50_000;
        const caller = Keypair.generate();

        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );
        const callerUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            caller.publicKey
        );

        await managerWithdraw(setup, withdrawAmount, managerReceiverTokenAccount);
        await mintTokens(
            setup.underlyingMint,
            callerUnderlyingTokenAccount,
            returnAmount
        );

        await managerDeposit(
            setup,
            returnAmount,
            callerUnderlyingTokenAccount,
            caller,
            caller.publicKey
        );

        const callerUnderlying = await fetchTokenAccount(callerUnderlyingTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(callerUnderlying.amount.toString(), "0");
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawAmount + returnAmount).toString()
        );
        assert.equal(
            vaultState.floatOutstanding.toString(),
            (withdrawAmount - returnAmount).toString()
        );
    });

    it("rejects zero amount", async () => {
        const depositAmount = 1_000;

        const setup = await setupVaultWithDeposit(depositAmount);
        const callerUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await managerDeposit(setup, 0, callerUnderlyingTokenAccount);

            assert.fail("Expected manager_deposit to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }

        const callerUnderlying = await fetchTokenAccount(callerUnderlyingTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(callerUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("sets outstanding float to zero and keeps excess as vault assets", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const returnAmount = 150_000;
        const excessAmount = returnAmount - withdrawAmount;
        const caller = Keypair.generate();

        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );
        const callerUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            caller.publicKey
        );

        await managerWithdraw(setup, withdrawAmount, managerReceiverTokenAccount);
        await mintTokens(
            setup.underlyingMint,
            callerUnderlyingTokenAccount,
            returnAmount
        );

        await managerDeposit(
            setup,
            returnAmount,
            callerUnderlyingTokenAccount,
            caller,
            caller.publicKey
        );

        const callerUnderlying = await fetchTokenAccount(callerUnderlyingTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(callerUnderlying.amount.toString(), "0");
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount + excessAmount).toString()
        );
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("rejects returns from the wrong mint", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const returnAmount = 10_000;
        const caller = Keypair.generate();

        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );
        const wrongMint = await createUnderlyingMint();
        const callerWrongMintTokenAccount = await createTokenAccount(
            wrongMint,
            caller.publicKey
        );

        await managerWithdraw(setup, withdrawAmount, managerReceiverTokenAccount);
        await mintTokens(wrongMint, callerWrongMintTokenAccount, returnAmount);

        try {
            await managerDeposit(
                setup,
                returnAmount,
                callerWrongMintTokenAccount,
                caller,
                caller.publicKey
            );

            assert.fail("Expected manager_deposit to reject wrong mint source");
        } catch (error) {
            assertErrorIncludesAny(error, ["ConstraintTokenMint", "token mint"]);
        }

        const callerWrongMintAccount = await fetchTokenAccount(
            callerWrongMintTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(callerWrongMintAccount.amount.toString(), returnAmount.toString());
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawAmount).toString()
        );
        assert.equal(vaultState.floatOutstanding.toString(), withdrawAmount.toString());
    });

    it("rejects returns to a non-canonical destination", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const returnAmount = 10_000;
        const caller = Keypair.generate();
        const wrongDestinationOwner = Keypair.generate();

        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );
        const callerUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            caller.publicKey
        );
        const wrongDestinationTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            wrongDestinationOwner.publicKey
        );

        await managerWithdraw(setup, withdrawAmount, managerReceiverTokenAccount);
        await mintTokens(
            setup.underlyingMint,
            callerUnderlyingTokenAccount,
            returnAmount
        );

        try {
            await managerDeposit(
                setup,
                returnAmount,
                callerUnderlyingTokenAccount,
                caller,
                caller.publicKey,
                wrongDestinationTokenAccount
            );

            assert.fail("Expected manager_deposit to reject wrong destination");
        } catch (error) {
            assertErrorIncludesAny(error, ["ConstraintHasOne", "has one"]);
        }

        const callerUnderlying = await fetchTokenAccount(callerUnderlyingTokenAccount);
        const wrongDestination = await fetchTokenAccount(wrongDestinationTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(callerUnderlying.amount.toString(), returnAmount.toString());
        assert.equal(wrongDestination.amount.toString(), "0");
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawAmount).toString()
        );
        assert.equal(vaultState.floatOutstanding.toString(), withdrawAmount.toString());
    });
});
