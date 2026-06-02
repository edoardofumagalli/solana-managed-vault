import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair } from "@solana/web3.js";

import { connection, manager, program } from "../../helpers/setup";
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchTokenAccount,
    mintTokens,
} from "../../helpers/token";
import { setupVaultWithDeposit } from "../../helpers/vault";
import {
    managerDeposit,
    requestAndExecuteManagerWithdraw as managerWithdraw,
    waitUntilSlot,
} from "../../helpers/manager";

const ZERO_DELAY = new anchor.BN(0);

async function setupManagerDepositVault(depositAmount: number) {
    return setupVaultWithDeposit(depositAmount, {
        managerWithdrawDelaySlots: ZERO_DELAY,
    });
}

function assertErrorIncludesAny(error: unknown, expectedParts: string[]) {
    const message = String(error);
    assert.isTrue(
        expectedParts.some((part) => message.includes(part)),
        `Expected error to include one of ${expectedParts.join(", ")}, got: ${message}`
    );
}

describe("manager_deposit", () => {
    before(async () => {
        const currentSlot = await connection.getSlot();
        await waitUntilSlot(new anchor.BN(currentSlot + 1));
    });

    it("lets a non-manager return underlying and reduce outstanding float", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 200_000;
        const returnAmount = 50_000;
        const caller = Keypair.generate();

        const setup = await setupManagerDepositVault(depositAmount);
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

        const setup = await setupManagerDepositVault(depositAmount);
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

        const setup = await setupManagerDepositVault(depositAmount);
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

        const setup = await setupManagerDepositVault(depositAmount);
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

        const setup = await setupManagerDepositVault(depositAmount);
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
