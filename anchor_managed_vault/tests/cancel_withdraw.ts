import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
    DEFAULT_MAX_FLOAT_BPS,
    connection,
    manager,
    program,
} from "./helpers/setup";
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
    transferTokens,
} from "./helpers/token";

type VaultTestSetup = {
    underlyingMint: PublicKey;
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    userUnderlyingTokenAccount: PublicKey;
    userShareTokenAccount: PublicKey;
};

type WithdrawAccounts = {
    userPosition: PublicKey;
    withdrawTicket: PublicKey;
    escrowShareTokenAccount: PublicKey;
};

async function setupVaultWithDeposit(
    depositAmount: number
): Promise<VaultTestSetup> {
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

function deriveWithdrawAccounts(
    vault: PublicKey,
    ticketIndex: number
): WithdrawAccounts {
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

async function requestWithdraw(
    setup: VaultTestSetup,
    ticketIndex: number,
    sharesAmount: number
): Promise<WithdrawAccounts> {
    const accounts = deriveWithdrawAccounts(setup.vault, ticketIndex);

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

async function cancelWithdraw(
    setup: VaultTestSetup,
    accounts: WithdrawAccounts
): Promise<void> {
    await program.methods
        .cancelWithdraw()
        .accountsPartial({
            user: manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            userShareTokenAccount: setup.userShareTokenAccount,
            userPosition: accounts.userPosition,
            withdrawTicket: accounts.withdrawTicket,
            escrowShareTokenAccount: accounts.escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
}

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
