import { assert } from "chai";

import { connection, manager, program } from "../../helpers/setup";
import { fetchTokenAccount, transferTokens } from "../../helpers/token";
import { setupVaultWithDeposit } from "../../helpers/vault";
import { cancelWithdraw, requestWithdraw } from "../../helpers/withdraw";

describe("cancel_withdraw", () => {
    it("returns escrowed shares, closes accounts, and advances the queue", async () => {
        const depositAmount = 1_000_000;
        const sharesToWithdraw = 250_000;

        const setup = await setupVaultWithDeposit(depositAmount);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        await cancelWithdraw(setup, accounts);

        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        const userPosition = await program.account.userVaultPosition.fetch(
            accounts.userPosition
        );
        const vaultState = await program.account.vault.fetch(setup.vault);
        const ticketInfo = await connection.getAccountInfo(
            accounts.withdrawTicket
        );
        const escrowInfo = await connection.getAccountInfo(
            accounts.escrowShareTokenAccount
        );

        assert.equal(userShares.amount.toString(), depositAmount.toString());
        assert.equal(userPosition.pendingTicketCount, 0);
        assert.equal(vaultState.totalTickets.toNumber(), 1);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 1);
        assert.isNull(ticketInfo);
        assert.isNull(escrowInfo);
    });

    it("rejects cancelling a later ticket before the oldest one", async () => {
        const depositAmount = 1_000;
        const firstShares = 100;
        const secondShares = 200;

        const setup = await setupVaultWithDeposit(depositAmount);
        const firstAccounts = await requestWithdraw(setup, 0, firstShares);
        const secondAccounts = await requestWithdraw(setup, 1, secondShares);

        try {
            await cancelWithdraw(setup, secondAccounts);

            assert.fail("Expected cancel_withdraw to enforce FIFO order");
        } catch (error) {
            assert.include(String(error), "TicketOutOfOrder");
        }

        const firstTicketInfo = await connection.getAccountInfo(
            firstAccounts.withdrawTicket
        );
        const secondTicketInfo = await connection.getAccountInfo(
            secondAccounts.withdrawTicket
        );
        const firstEscrow = await fetchTokenAccount(
            firstAccounts.escrowShareTokenAccount
        );
        const secondEscrow = await fetchTokenAccount(
            secondAccounts.escrowShareTokenAccount
        );
        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        const userPosition = await program.account.userVaultPosition.fetch(
            firstAccounts.userPosition
        );
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isNotNull(firstTicketInfo);
        assert.isNotNull(secondTicketInfo);
        assert.equal(firstEscrow.amount.toString(), firstShares.toString());
        assert.equal(secondEscrow.amount.toString(), secondShares.toString());
        assert.equal(
            userShares.amount.toString(),
            (depositAmount - firstShares - secondShares).toString()
        );
        assert.equal(userPosition.pendingTicketCount, 2);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 0);
    });

    it("allows the next ticket to be cancelled after the oldest one is cancelled", async () => {
        const depositAmount = 1_000;
        const firstShares = 100;
        const secondShares = 200;

        const setup = await setupVaultWithDeposit(depositAmount);
        const firstAccounts = await requestWithdraw(setup, 0, firstShares);
        const secondAccounts = await requestWithdraw(setup, 1, secondShares);

        await cancelWithdraw(setup, firstAccounts);

        let userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        let userPosition = await program.account.userVaultPosition.fetch(
            firstAccounts.userPosition
        );
        let vaultState = await program.account.vault.fetch(setup.vault);
        let firstTicketInfo = await connection.getAccountInfo(
            firstAccounts.withdrawTicket
        );
        let secondTicketInfo = await connection.getAccountInfo(
            secondAccounts.withdrawTicket
        );

        assert.equal(
            userShares.amount.toString(),
            (depositAmount - secondShares).toString()
        );
        assert.equal(userPosition.pendingTicketCount, 1);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 1);
        assert.isNull(firstTicketInfo);
        assert.isNotNull(secondTicketInfo);

        await cancelWithdraw(setup, secondAccounts);

        userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        userPosition = await program.account.userVaultPosition.fetch(
            secondAccounts.userPosition
        );
        vaultState = await program.account.vault.fetch(setup.vault);
        secondTicketInfo = await connection.getAccountInfo(
            secondAccounts.withdrawTicket
        );
        const secondEscrowInfo = await connection.getAccountInfo(
            secondAccounts.escrowShareTokenAccount
        );

        assert.equal(userShares.amount.toString(), depositAmount.toString());
        assert.equal(userPosition.pendingTicketCount, 0);
        assert.equal(vaultState.totalTickets.toNumber(), 2);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 2);
        assert.isNull(secondTicketInfo);
        assert.isNull(secondEscrowInfo);
    });

    it("returns extra shares sent directly to the escrow before closing it", async () => {
        const depositAmount = 1_000;
        const sharesToWithdraw = 100;
        const extraEscrowShares = 1;

        const setup = await setupVaultWithDeposit(depositAmount);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        await transferTokens(
            setup.userShareTokenAccount,
            accounts.escrowShareTokenAccount,
            extraEscrowShares
        );

        const escrowBeforeCancel = await fetchTokenAccount(
            accounts.escrowShareTokenAccount
        );
        assert.equal(
            escrowBeforeCancel.amount.toString(),
            (sharesToWithdraw + extraEscrowShares).toString()
        );

        await cancelWithdraw(setup, accounts);

        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        const escrowInfo = await connection.getAccountInfo(
            accounts.escrowShareTokenAccount
        );
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(userShares.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 1);
        assert.isNull(escrowInfo);
    });
});
