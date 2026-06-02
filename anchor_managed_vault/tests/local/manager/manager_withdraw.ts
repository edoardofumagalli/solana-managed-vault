import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair } from "@solana/web3.js";

import { DEFAULT_MAX_FLOAT_BPS, connection, manager, program } from "../../helpers/setup";
import { createTokenAccount, fetchTokenAccount } from "../../helpers/token";
import { assertPublicKeyEquals } from "../../helpers/assertions";
import { setupVaultWithDeposit } from "../../helpers/vault";
import {
    executeManagerWithdraw,
    requestAndExecuteManagerWithdraw,
    requestManagerWithdraw,
} from "../../helpers/manager";

const ZERO_DELAY = new anchor.BN(0);
const LONG_DELAY = new anchor.BN(1_000);

describe("manager withdraw timelock", () => {
    it("creates a manager withdrawal request without moving funds", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 200_000;
        const setup = await setupVaultWithDeposit(
            depositAmount,
            DEFAULT_MAX_FLOAT_BPS,
            LONG_DELAY
        );
        const receiver = Keypair.generate();
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            receiver.publicKey
        );

        const request = await requestManagerWithdraw(
            setup,
            withdrawAmount,
            receiverUnderlyingTokenAccount
        );

        const requestState = await program.account.managerWithdrawRequest.fetch(
            request
        );
        const vaultState = await program.account.vault.fetch(setup.vault);
        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);

        assertPublicKeyEquals(requestState.vault, setup.vault, "vault mismatch");
        assertPublicKeyEquals(requestState.manager, manager, "manager mismatch");
        assertPublicKeyEquals(
            requestState.receiverUnderlyingTokenAccount,
            receiverUnderlyingTokenAccount,
            "receiver mismatch"
        );
        assert.equal(requestState.requestId.toNumber(), 0);
        assert.equal(requestState.amount.toString(), withdrawAmount.toString());
        assert.equal(
            requestState.executableAfterSlot.toString(),
            requestState.requestedSlot.add(LONG_DELAY).toString()
        );
        assert.equal(vaultState.nextManagerWithdrawRequestId.toNumber(), 1);
        assert.equal(vaultState.floatOutstanding.toString(), "0");
        assert.equal(receiverUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
    });

    it("executes a ready request and closes the request account", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 200_000;
        const receiver = Keypair.generate();

        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            receiver.publicKey
        );

        const request = await requestAndExecuteManagerWithdraw(
            setup,
            withdrawAmount,
            receiverUnderlyingTokenAccount
        );

        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);
        const requestInfo = await program.provider.connection.getAccountInfo(request);

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
        assert.isNull(requestInfo);
    });

    it("rejects execution before the timelock has elapsed", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const setup = await setupVaultWithDeposit(
            depositAmount,
            DEFAULT_MAX_FLOAT_BPS,
            LONG_DELAY
        );
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );
        const request = await requestManagerWithdraw(
            setup,
            withdrawAmount,
            receiverUnderlyingTokenAccount
        );

        try {
            await executeManagerWithdraw(
                setup,
                request,
                receiverUnderlyingTokenAccount
            );

            assert.fail("Expected execute_manager_withdraw to enforce timelock");
        } catch (error) {
            assert.include(String(error), "ManagerWithdrawTimelockNotElapsed");
        }

        const requestInfo = await program.provider.connection.getAccountInfo(request);
        const receiverUnderlying = await fetchTokenAccount(
            receiverUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isNotNull(requestInfo);
        assert.equal(receiverUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("rejects zero amount requests", async () => {
        const setup = await setupVaultWithDeposit(1_000);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await requestManagerWithdraw(setup, 0, receiverUnderlyingTokenAccount);

            assert.fail("Expected request_manager_withdraw to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }
    });

    it("rejects requests above the float cap", async () => {
        const depositAmount = 1_000_000;
        const overCapAmount = 200_001;
        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await requestManagerWithdraw(
                setup,
                overCapAmount,
                receiverUnderlyingTokenAccount
            );

            assert.fail("Expected request_manager_withdraw to enforce the float cap");
        } catch (error) {
            assert.include(String(error), "FloatCapExceeded");
        }
    });

    it("rejects unauthorized request managers", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const unauthorizedManager = Keypair.generate();
        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            unauthorizedManager.publicKey
        );
        const airdropSignature = await program.provider.connection.requestAirdrop(
            unauthorizedManager.publicKey,
            1_000_000_000
        );
        await program.provider.connection.confirmTransaction(
            airdropSignature,
            "confirmed"
        );

        try {
            await requestManagerWithdraw(
                setup,
                withdrawAmount,
                receiverUnderlyingTokenAccount,
                unauthorizedManager,
                unauthorizedManager.publicKey
            );

            assert.fail("Expected request_manager_withdraw to reject unauthorized manager");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }
    });

    it("rejects requests above vault liquidity", async () => {
        const depositAmount = 1_000;
        const withdrawAmount = depositAmount + 1;
        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await requestManagerWithdraw(
                setup,
                withdrawAmount,
                receiverUnderlyingTokenAccount
            );

            assert.fail("Expected request_manager_withdraw to reject insufficient liquidity");
        } catch (error) {
            assert.include(String(error), "InsufficientLiquidity");
        }
    });

    it("blocks pending request execution after emergency shutdown", async () => {
        const depositAmount = 1_000_000;
        const withdrawAmount = 100_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const receiverUnderlyingTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );
        const request = await requestManagerWithdraw(
            setup,
            withdrawAmount,
            receiverUnderlyingTokenAccount
        );

        await program.methods
            .activateEmergencyShutdown()
            .accountsPartial({
                emergencyAdmin: manager,
                vault: setup.vault,
            })
            .rpc();

        try {
            await executeManagerWithdraw(
                setup,
                request,
                receiverUnderlyingTokenAccount
            );

            assert.fail("Expected execute_manager_withdraw to fail after shutdown");
        } catch (error) {
            assert.include(String(error), "VaultShutdown");
        }
    });
});
