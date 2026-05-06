import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
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
    fetchMint,
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

async function processWithdraw(
    setup: VaultTestSetup,
    accounts: WithdrawAccounts
): Promise<void> {
    await program.methods
        .processWithdraw()
        .accountsPartial({
            user: manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            userUnderlyingTokenAccount: setup.userUnderlyingTokenAccount,
            userPosition: accounts.userPosition,
            withdrawTicket: accounts.withdrawTicket,
            escrowShareTokenAccount: accounts.escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
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
    caller: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .managerDeposit(new anchor.BN(amount))
        .accountsPartial({
            caller,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            callerUnderlyingTokenAccount,
            vaultTokenAccount: setup.vaultTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
}

function sharesToAssetsDown(
    shares: number,
    totalAssets: number,
    totalShares: number
): anchor.BN {
    const virtualAssets = new anchor.BN(1_000);
    const virtualShares = new anchor.BN(1_000);

    return new anchor.BN(shares)
        .mul(new anchor.BN(totalAssets).add(virtualAssets))
        .div(new anchor.BN(totalShares).add(virtualShares));
}

describe("process_withdraw", () => {
    it("transfers assets, burns escrowed shares, closes accounts, and advances the queue", async () => {
        const depositAmount = 1_000_000;
        const sharesToWithdraw = 250_000;

        const setup = await setupVaultWithDeposit(depositAmount);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);
        const expectedAssetsOut = sharesToAssetsDown(
            sharesToWithdraw,
            depositAmount,
            depositAmount
        );

        await processWithdraw(setup, accounts);

        const userUnderlying = await fetchTokenAccount(
            setup.userUnderlyingTokenAccount
        );
        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const shareMintAccount = await fetchMint(setup.shareMint);
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

        assert.equal(userUnderlying.amount.toString(), expectedAssetsOut.toString());
        assert.equal(
            userShares.amount.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(depositAmount).sub(expectedAssetsOut).toString()
        );
        assert.equal(
            shareMintAccount.supply.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(userPosition.pendingTicketCount, 0);
        assert.equal(vaultState.totalTickets.toNumber(), 1);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 1);
        assert.isNull(ticketInfo);
        assert.isNull(escrowInfo);
    });

    it("uses the share price at processing time", async () => {
        const depositAmount = 1_000_000;
        const sharesToWithdraw = 250_000;
        const donationAmount = 250_000;

        const setup = await setupVaultWithDeposit(depositAmount);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        await mintTokens(
            setup.underlyingMint,
            setup.userUnderlyingTokenAccount,
            donationAmount
        );
        await transferTokens(
            setup.userUnderlyingTokenAccount,
            setup.vaultTokenAccount,
            donationAmount
        );

        const totalAssetsAtProcessing = depositAmount + donationAmount;
        const expectedAssetsOut = sharesToAssetsDown(
            sharesToWithdraw,
            totalAssetsAtProcessing,
            depositAmount
        );

        await processWithdraw(setup, accounts);

        const userUnderlying = await fetchTokenAccount(
            setup.userUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const shareMintAccount = await fetchMint(setup.shareMint);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isTrue(expectedAssetsOut.gt(new anchor.BN(sharesToWithdraw)));
        assert.equal(userUnderlying.amount.toString(), expectedAssetsOut.toString());
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(totalAssetsAtProcessing)
                .sub(expectedAssetsOut)
                .toString()
        );
        assert.equal(
            shareMintAccount.supply.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 1);
    });

    it("rejects processing a later ticket before the oldest one", async () => {
        const depositAmount = 1_000;
        const firstShares = 100;
        const secondShares = 200;

        const setup = await setupVaultWithDeposit(depositAmount);
        const firstAccounts = await requestWithdraw(setup, 0, firstShares);
        const secondAccounts = await requestWithdraw(setup, 1, secondShares);

        try {
            await processWithdraw(setup, secondAccounts);

            assert.fail("Expected process_withdraw to enforce FIFO order");
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
        const userUnderlying = await fetchTokenAccount(
            setup.userUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const userPosition = await program.account.userVaultPosition.fetch(
            firstAccounts.userPosition
        );
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isNotNull(firstTicketInfo);
        assert.isNotNull(secondTicketInfo);
        assert.equal(firstEscrow.amount.toString(), firstShares.toString());
        assert.equal(secondEscrow.amount.toString(), secondShares.toString());
        assert.equal(userUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(userPosition.pendingTicketCount, 2);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 0);
    });

    it("allows the next ticket to be processed after the oldest one is processed", async () => {
        const depositAmount = 1_000;
        const firstShares = 100;
        const secondShares = 200;

        const setup = await setupVaultWithDeposit(depositAmount);
        const firstAccounts = await requestWithdraw(setup, 0, firstShares);
        const secondAccounts = await requestWithdraw(setup, 1, secondShares);

        const firstExpectedAssetsOut = sharesToAssetsDown(
            firstShares,
            depositAmount,
            depositAmount
        );

        await processWithdraw(setup, firstAccounts);

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
        let userUnderlying = await fetchTokenAccount(
            setup.userUnderlyingTokenAccount
        );

        assert.equal(userUnderlying.amount.toString(), firstExpectedAssetsOut.toString());
        assert.equal(userPosition.pendingTicketCount, 1);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 1);
        assert.isNull(firstTicketInfo);
        assert.isNotNull(secondTicketInfo);

        const totalAssetsBeforeSecondProcess = new anchor.BN(depositAmount).sub(
            firstExpectedAssetsOut
        );
        const totalSharesBeforeSecondProcess = depositAmount - firstShares;
        const secondExpectedAssetsOut = sharesToAssetsDown(
            secondShares,
            totalAssetsBeforeSecondProcess.toNumber(),
            totalSharesBeforeSecondProcess
        );

        await processWithdraw(setup, secondAccounts);

        userUnderlying = await fetchTokenAccount(setup.userUnderlyingTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const shareMintAccount = await fetchMint(setup.shareMint);
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

        const totalExpectedAssetsOut = firstExpectedAssetsOut.add(
            secondExpectedAssetsOut
        );

        assert.equal(userUnderlying.amount.toString(), totalExpectedAssetsOut.toString());
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(depositAmount)
                .sub(totalExpectedAssetsOut)
                .toString()
        );
        assert.equal(
            shareMintAccount.supply.toString(),
            (depositAmount - firstShares - secondShares).toString()
        );
        assert.equal(userPosition.pendingTicketCount, 0);
        assert.equal(vaultState.totalTickets.toNumber(), 2);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 2);
        assert.isNull(secondTicketInfo);
        assert.isNull(secondEscrowInfo);
    });

    it("keeps a ticket pending when liquidity is insufficient, then processes after float is returned", async () => {
        const depositAmount = 1_000_000;
        const floatAmount = 700_000;
        const returnedFloat = 300_000;
        const sharesToWithdraw = 500_000;

        const setup = await setupVaultWithDeposit(depositAmount, 8_000);
        const managerReceiver = Keypair.generate();
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            managerReceiver.publicKey
        );

        await managerWithdraw(setup, floatAmount, managerReceiverTokenAccount);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        const expectedAssetsOut = sharesToAssetsDown(
            sharesToWithdraw,
            depositAmount,
            depositAmount
        );

        try {
            await processWithdraw(setup, accounts);

            assert.fail("Expected process_withdraw to reject insufficient liquidity");
        } catch (error) {
            assert.include(String(error), "InsufficientLiquidity");
        }

        let vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        let managerReceiverToken = await fetchTokenAccount(managerReceiverTokenAccount);
        let escrowShares = await fetchTokenAccount(accounts.escrowShareTokenAccount);
        let userPosition = await program.account.userVaultPosition.fetch(
            accounts.userPosition
        );
        let vaultState = await program.account.vault.fetch(setup.vault);
        let ticketInfo = await connection.getAccountInfo(accounts.withdrawTicket);
        let escrowInfo = await connection.getAccountInfo(
            accounts.escrowShareTokenAccount
        );

        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - floatAmount).toString()
        );
        assert.equal(managerReceiverToken.amount.toString(), floatAmount.toString());
        assert.equal(escrowShares.amount.toString(), sharesToWithdraw.toString());
        assert.equal(userPosition.pendingTicketCount, 1);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 0);
        assert.equal(vaultState.floatOutstanding.toString(), floatAmount.toString());
        assert.isNotNull(ticketInfo);
        assert.isNotNull(escrowInfo);

        await managerDeposit(
            setup,
            returnedFloat,
            managerReceiverTokenAccount,
            managerReceiver,
            managerReceiver.publicKey
        );
        await processWithdraw(setup, accounts);

        const userUnderlying = await fetchTokenAccount(
            setup.userUnderlyingTokenAccount
        );
        const userShares = await fetchTokenAccount(setup.userShareTokenAccount);
        vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        managerReceiverToken = await fetchTokenAccount(managerReceiverTokenAccount);
        const shareMintAccount = await fetchMint(setup.shareMint);
        userPosition = await program.account.userVaultPosition.fetch(
            accounts.userPosition
        );
        vaultState = await program.account.vault.fetch(setup.vault);
        ticketInfo = await connection.getAccountInfo(accounts.withdrawTicket);
        escrowInfo = await connection.getAccountInfo(
            accounts.escrowShareTokenAccount
        );

        assert.equal(userUnderlying.amount.toString(), expectedAssetsOut.toString());
        assert.equal(
            userShares.amount.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(depositAmount)
                .sub(new anchor.BN(floatAmount))
                .add(new anchor.BN(returnedFloat))
                .sub(expectedAssetsOut)
                .toString()
        );
        assert.equal(
            managerReceiverToken.amount.toString(),
            (floatAmount - returnedFloat).toString()
        );
        assert.equal(
            shareMintAccount.supply.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(userPosition.pendingTicketCount, 0);
        assert.equal(vaultState.nextTicketToProcess.toNumber(), 1);
        assert.equal(
            vaultState.floatOutstanding.toString(),
            (floatAmount - returnedFloat).toString()
        );
        assert.isNull(ticketInfo);
        assert.isNull(escrowInfo);
    });

    it("blocks new manager withdrawals when processed withdrawals push the vault over the float cap", async () => {
        const depositAmount = 1_000_000;
        const initialFloat = 200_000;
        const sharesToWithdraw = 600_000;
        const floatReturnAmount = 121_000;
        const finalWithdrawAmount = 1;

        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiver = Keypair.generate();
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            managerReceiver.publicKey
        );

        await managerWithdraw(setup, initialFloat, managerReceiverTokenAccount);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        const expectedAssetsOut = sharesToAssetsDown(
            sharesToWithdraw,
            depositAmount,
            depositAmount
        );

        await processWithdraw(setup, accounts);

        let vaultState = await program.account.vault.fetch(setup.vault);
        let vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);

        assert.equal(vaultState.floatOutstanding.toString(), initialFloat.toString());
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(depositAmount)
                .sub(new anchor.BN(initialFloat))
                .sub(expectedAssetsOut)
                .toString()
        );

        try {
            await managerWithdraw(
                setup,
                finalWithdrawAmount,
                managerReceiverTokenAccount
            );

            assert.fail("Expected manager_withdraw to fail while vault is over cap");
        } catch (error) {
            assert.include(String(error), "FloatCapExceeded");
        }

        vaultState = await program.account.vault.fetch(setup.vault);
        vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);

        assert.equal(vaultState.floatOutstanding.toString(), initialFloat.toString());
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(depositAmount)
                .sub(new anchor.BN(initialFloat))
                .sub(expectedAssetsOut)
                .toString()
        );

        await managerDeposit(
            setup,
            floatReturnAmount,
            managerReceiverTokenAccount,
            managerReceiver,
            managerReceiver.publicKey
        );
        await managerWithdraw(
            setup,
            finalWithdrawAmount,
            managerReceiverTokenAccount
        );

        vaultState = await program.account.vault.fetch(setup.vault);
        vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const managerReceiverToken = await fetchTokenAccount(managerReceiverTokenAccount);

        assert.equal(
            vaultState.floatOutstanding.toString(),
            (initialFloat - floatReturnAmount + finalWithdrawAmount).toString()
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(depositAmount)
                .sub(new anchor.BN(initialFloat))
                .sub(expectedAssetsOut)
                .add(new anchor.BN(floatReturnAmount))
                .sub(new anchor.BN(finalWithdrawAmount))
                .toString()
        );
        assert.equal(
            managerReceiverToken.amount.toString(),
            (initialFloat - floatReturnAmount + finalWithdrawAmount).toString()
        );
    });

});
