import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { DEFAULT_MAX_FLOAT_BPS, manager, program } from "./helpers/setup";
import {
    deriveEscrowShareTokenAccountPda,
    deriveShareMintPda,
    deriveUserVaultPositionPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
    deriveWithdrawTicketPda,
} from "./helpers/pda";
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchTokenAccount,
    mintTokens,
} from "./helpers/token";
import { assertPublicKeyEquals } from "./helpers/assertions";

const MAX_PENDING_TICKETS_PER_USER = 8;

async function setupVaultWithDeposit(depositAmount: number) {
    const underlyingMint = await createUnderlyingMint();

    const [vault] = deriveVaultPda(underlyingMint);
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

    const userUnderlyingTokenAccount = await createTokenAccount(
        underlyingMint,
        manager
    );
    const userShareTokenAccount = await createTokenAccount(shareMint, manager);

    await mintTokens(
        underlyingMint,
        userUnderlyingTokenAccount,
        depositAmount
    );

    await program.methods
        .deposit(new anchor.BN(depositAmount))
        .accountsPartial({
            depositor: manager,
            vault,
            underlyingMint,
            depositorUnderlyingTokenAccount: userUnderlyingTokenAccount,
            shareMint,
            vaultTokenAccount,
            depositorShareTokenAccount: userShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

    return {
        underlyingMint,
        vault,
        shareMint,
        vaultTokenAccount,
        userUnderlyingTokenAccount,
        userShareTokenAccount,
    };
}

function deriveRequestWithdrawAccounts(vault, ticketIndex: number) {
    const [userPosition] = deriveUserVaultPositionPda(vault, manager);
    const [withdrawTicket] = deriveWithdrawTicketPda(vault, manager, ticketIndex);
    const [escrowShareTokenAccount] = deriveEscrowShareTokenAccountPda(
        withdrawTicket
    );

    return {
        userPosition,
        withdrawTicket,
        escrowShareTokenAccount,
    };
}

async function requestWithdraw(setup, ticketIndex: number, sharesAmount: number) {
    const accounts = deriveRequestWithdrawAccounts(setup.vault, ticketIndex);

    await program.methods
        .requestWithdraw(new anchor.BN(sharesAmount))
        .accountsPartial({
            user: manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            userShareTokenAccount: setup.userShareTokenAccount,
            userPosition: accounts.userPosition,
            withdrawTicket: accounts.withdrawTicket,
            escrowShareTokenAccount: accounts.escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    return accounts;
}

describe("request_withdraw", () => {
    it("moves requested shares into escrow and creates a ticket", async () => {
        const depositAmount = 1_000_000;
        const sharesToWithdraw = 250_000;

        const setup = await setupVaultWithDeposit(depositAmount);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        const escrowShares = await fetchTokenAccount(
            accounts.escrowShareTokenAccount
        );
        const ticket = await program.account.withdrawTicket.fetch(
            accounts.withdrawTicket
        );
        const userPosition = await program.account.userVaultPosition.fetch(
            accounts.userPosition
        );
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(
            userShares.amount.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(escrowShares.amount.toString(), sharesToWithdraw.toString());
        assertPublicKeyEquals(escrowShares.mint, setup.shareMint, "escrow mint mismatch");
        assertPublicKeyEquals(
            escrowShares.owner,
            accounts.withdrawTicket,
            "escrow owner mismatch"
        );

        assertPublicKeyEquals(ticket.vault, setup.vault, "ticket vault mismatch");
        assertPublicKeyEquals(ticket.user, manager, "ticket user mismatch");
        assertPublicKeyEquals(
            ticket.escrowShareTokenAccount,
            accounts.escrowShareTokenAccount,
            "ticket escrow mismatch"
        );
        assert.equal(ticket.ticketIndex.toNumber(), 0);
        assert.equal(ticket.shares.toString(), sharesToWithdraw.toString());
        assert.isAbove(ticket.requestedSlot.toNumber(), 0);

        assertPublicKeyEquals(userPosition.vault, setup.vault, "position vault mismatch");
        assertPublicKeyEquals(userPosition.user, manager, "position user mismatch");
        assert.equal(userPosition.pendingTicketCount, 1);
        assert.equal(vaultState.totalTickets.toNumber(), 1);
    });

    it("rejects zero shares", async () => {
        const depositAmount = 1_000;

        const setup = await setupVaultWithDeposit(depositAmount);
        const accounts = deriveRequestWithdrawAccounts(setup.vault, 0);

        try {
            await program.methods
                .requestWithdraw(new anchor.BN(0))
                .accountsPartial({
                    user: manager,
                    vault: setup.vault,
                    underlyingMint: setup.underlyingMint,
                    shareMint: setup.shareMint,
                    vaultTokenAccount: setup.vaultTokenAccount,
                    userShareTokenAccount: setup.userShareTokenAccount,
                    userPosition: accounts.userPosition,
                    withdrawTicket: accounts.withdrawTicket,
                    escrowShareTokenAccount: accounts.escrowShareTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            assert.fail("Expected request_withdraw to reject zero shares");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }

        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(userShares.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.totalTickets.toNumber(), 0);
    });

    it("rejects more shares than the user owns", async () => {
        const depositAmount = 1_000;
        const sharesToWithdraw = depositAmount + 1;

        const setup = await setupVaultWithDeposit(depositAmount);
        const accounts = deriveRequestWithdrawAccounts(setup.vault, 0);

        try {
            await program.methods
                .requestWithdraw(new anchor.BN(sharesToWithdraw))
                .accountsPartial({
                    user: manager,
                    vault: setup.vault,
                    underlyingMint: setup.underlyingMint,
                    shareMint: setup.shareMint,
                    vaultTokenAccount: setup.vaultTokenAccount,
                    userShareTokenAccount: setup.userShareTokenAccount,
                    userPosition: accounts.userPosition,
                    withdrawTicket: accounts.withdrawTicket,
                    escrowShareTokenAccount: accounts.escrowShareTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            assert.fail("Expected request_withdraw to reject insufficient shares");
        } catch (error) {
            assert.include(String(error), "InsufficientShares");
        }

        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(userShares.amount.toString(), depositAmount.toString());
        assert.equal(vaultState.totalTickets.toNumber(), 0);
    });

    it("increments ticket index across multiple requests", async () => {
        const depositAmount = 1_000;
        const firstShares = 100;
        const secondShares = 200;

        const setup = await setupVaultWithDeposit(depositAmount);
        const firstAccounts = await requestWithdraw(setup, 0, firstShares);
        const secondAccounts = await requestWithdraw(setup, 1, secondShares);

        const firstTicket = await program.account.withdrawTicket.fetch(
            firstAccounts.withdrawTicket
        );
        const secondTicket = await program.account.withdrawTicket.fetch(
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

        assert.equal(firstTicket.ticketIndex.toNumber(), 0);
        assert.equal(secondTicket.ticketIndex.toNumber(), 1);
        assert.equal(firstTicket.shares.toString(), firstShares.toString());
        assert.equal(secondTicket.shares.toString(), secondShares.toString());
        assert.equal(firstEscrow.amount.toString(), firstShares.toString());
        assert.equal(secondEscrow.amount.toString(), secondShares.toString());
        assert.equal(
            userShares.amount.toString(),
            (depositAmount - firstShares - secondShares).toString()
        );
        assert.equal(userPosition.pendingTicketCount, 2);
        assert.equal(vaultState.totalTickets.toNumber(), 2);
    });

    it("rejects requests above the per-user pending ticket cap", async () => {
        const depositAmount = 10;
        const setup = await setupVaultWithDeposit(depositAmount);

        for (let ticketIndex = 0; ticketIndex < MAX_PENDING_TICKETS_PER_USER; ticketIndex++) {
            await requestWithdraw(setup, ticketIndex, 1);
        }

        const cappedAccounts = deriveRequestWithdrawAccounts(
            setup.vault,
            MAX_PENDING_TICKETS_PER_USER
        );

        try {
            await program.methods
                .requestWithdraw(new anchor.BN(1))
                .accountsPartial({
                    user: manager,
                    vault: setup.vault,
                    underlyingMint: setup.underlyingMint,
                    shareMint: setup.shareMint,
                    vaultTokenAccount: setup.vaultTokenAccount,
                    userShareTokenAccount: setup.userShareTokenAccount,
                    userPosition: cappedAccounts.userPosition,
                    withdrawTicket: cappedAccounts.withdrawTicket,
                    escrowShareTokenAccount: cappedAccounts.escrowShareTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            assert.fail("Expected request_withdraw to reject too many pending tickets");
        } catch (error) {
            assert.include(String(error), "TooManyPendingTickets");
        }

        const userPosition = await program.account.userVaultPosition.fetch(
            cappedAccounts.userPosition
        );
        const vaultState = await program.account.vault.fetch(setup.vault);
        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);

        assert.equal(userPosition.pendingTicketCount, MAX_PENDING_TICKETS_PER_USER);
        assert.equal(vaultState.totalTickets.toNumber(), MAX_PENDING_TICKETS_PER_USER);
        assert.equal(
            userShares.amount.toString(),
            (depositAmount - MAX_PENDING_TICKETS_PER_USER).toString()
        );
    });
});
