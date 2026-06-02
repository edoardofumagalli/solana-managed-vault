import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
    DEFAULT_MAX_FLOAT_BPS,
    manager,
    program,
} from "../../helpers/setup";
import {
    deriveEscrowShareTokenAccountPda,
    deriveManagerWithdrawRequestPda,
    deriveShareMintPda,
    deriveUserVaultPositionPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
    deriveWithdrawTicketPda,
} from "../../helpers/pda";
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchMint,
    fetchTokenAccount,
    mintTokens,
} from "../../helpers/token";

const ZERO_DELAY = new anchor.BN(0);

type VaultTestSetup = {
    underlyingMint: PublicKey;
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    emergencyAdmin: Keypair;
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
    const emergencyAdmin = Keypair.generate();

    const [vault] = deriveVaultPda(underlyingMint);
    const [shareMint] = deriveShareMintPda(vault);
    const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

    await program.methods
        .initializeVault(maxFloatBps, emergencyAdmin.publicKey, ZERO_DELAY)
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
        emergencyAdmin,
        userUnderlyingTokenAccount,
        userShareTokenAccount,
    };
}

async function createExternalUnderlyingTokenAccount(
    setup: VaultTestSetup
): Promise<PublicKey> {
    const receiver = Keypair.generate();

    return createTokenAccount(setup.underlyingMint, receiver.publicKey);
}

async function requestManagerWithdraw(
    setup: VaultTestSetup,
    amount: number,
    receiverUnderlyingTokenAccount: PublicKey
): Promise<PublicKey> {
    const vaultState = await program.account.vault.fetch(setup.vault);
    const [managerWithdrawRequest] = deriveManagerWithdrawRequestPda(
        setup.vault,
        vaultState.nextManagerWithdrawRequestId
    );

    await program.methods
        .requestManagerWithdraw(new anchor.BN(amount))
        .accountsPartial({
            manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            receiverUnderlyingTokenAccount,
            managerWithdrawRequest,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    return managerWithdrawRequest;
}

async function executeManagerWithdraw(
    setup: VaultTestSetup,
    managerWithdrawRequest: PublicKey,
    receiverUnderlyingTokenAccount: PublicKey
): Promise<void> {
    await program.methods
        .executeManagerWithdraw()
        .accountsPartial({
            executor: manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            receiverUnderlyingTokenAccount,
            managerWithdrawRequest,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
}

async function managerWithdraw(
    setup: VaultTestSetup,
    amount: number,
    receiverUnderlyingTokenAccount: PublicKey
): Promise<PublicKey> {
    const managerWithdrawRequest = await requestManagerWithdraw(
        setup,
        amount,
        receiverUnderlyingTokenAccount
    );

    await executeManagerWithdraw(
        setup,
        managerWithdrawRequest,
        receiverUnderlyingTokenAccount
    );

    return managerWithdrawRequest;
}

async function reportFloatValue(
    setup: VaultTestSetup,
    reportedFloatValue: number | anchor.BN,
    signer: Keypair | null = null,
    managerAccount: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .reportFloatValue(new anchor.BN(reportedFloatValue))
        .accountsPartial({
            manager: managerAccount,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
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

async function activateEmergencyShutdown(setup: VaultTestSetup): Promise<void> {
    await program.methods
        .activateEmergencyShutdown()
        .accountsPartial({
            emergencyAdmin: setup.emergencyAdmin.publicKey,
            vault: setup.vault,
        })
        .signers([setup.emergencyAdmin])
        .rpc();
}

describe("report_float_value", () => {
    it("lets the manager report a higher float value without moving tokens", async () => {
        const depositAmount = 1_000_000;
        const withdrawnFloat = 200_000;
        const reportedFloatValue = 250_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createExternalUnderlyingTokenAccount(
            setup
        );

        await managerWithdraw(setup, withdrawnFloat, managerReceiverTokenAccount);
        await reportFloatValue(setup, reportedFloatValue);

        const vaultState = await program.account.vault.fetch(setup.vault);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const managerReceiverUnderlying = await fetchTokenAccount(
            managerReceiverTokenAccount
        );

        assert.equal(
            vaultState.floatOutstanding.toString(),
            reportedFloatValue.toString()
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawnFloat).toString()
        );
        assert.equal(
            managerReceiverUnderlying.amount.toString(),
            withdrawnFloat.toString()
        );
    });

    it("lets the manager report a lower float value", async () => {
        const depositAmount = 1_000_000;
        const withdrawnFloat = 200_000;
        const reportedFloatValue = 80_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createExternalUnderlyingTokenAccount(
            setup
        );

        await managerWithdraw(setup, withdrawnFloat, managerReceiverTokenAccount);
        await reportFloatValue(setup, reportedFloatValue);

        const vaultState = await program.account.vault.fetch(setup.vault);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);

        assert.equal(
            vaultState.floatOutstanding.toString(),
            reportedFloatValue.toString()
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawnFloat).toString()
        );
    });

    it("allows reporting zero float value", async () => {
        const depositAmount = 1_000_000;
        const withdrawnFloat = 200_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createExternalUnderlyingTokenAccount(
            setup
        );

        await managerWithdraw(setup, withdrawnFloat, managerReceiverTokenAccount);
        await reportFloatValue(setup, 0);

        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("rejects reports from a non-manager", async () => {
        const depositAmount = 1_000_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const unauthorizedManager = Keypair.generate();

        try {
            await reportFloatValue(
                setup,
                123_000,
                unauthorizedManager,
                unauthorizedManager.publicKey
            );

            assert.fail("Expected report_float_value to reject non-manager signer");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("allows reporting during emergency shutdown", async () => {
        const depositAmount = 1_000_000;
        const withdrawnFloat = 200_000;
        const reportedFloatValue = 150_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createExternalUnderlyingTokenAccount(
            setup
        );

        await managerWithdraw(setup, withdrawnFloat, managerReceiverTokenAccount);
        await activateEmergencyShutdown(setup);
        await reportFloatValue(setup, reportedFloatValue);

        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isTrue(vaultState.isShutdown);
        assert.equal(
            vaultState.floatOutstanding.toString(),
            reportedFloatValue.toString()
        );
    });

    it("uses a higher reported float value when processing withdrawals", async () => {
        const depositAmount = 1_000_000;
        const withdrawnFloat = 200_000;
        const reportedFloatValue = 250_000;
        const sharesToWithdraw = 100_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createExternalUnderlyingTokenAccount(
            setup
        );

        await managerWithdraw(setup, withdrawnFloat, managerReceiverTokenAccount);
        await reportFloatValue(setup, reportedFloatValue);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        const totalAssetsAtProcessing =
            depositAmount - withdrawnFloat + reportedFloatValue;
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
        const shareMint = await fetchMint(setup.shareMint);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isTrue(expectedAssetsOut.gt(new anchor.BN(sharesToWithdraw)));
        assert.equal(userUnderlying.amount.toString(), expectedAssetsOut.toString());
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(depositAmount)
                .sub(new anchor.BN(withdrawnFloat))
                .sub(expectedAssetsOut)
                .toString()
        );
        assert.equal(
            shareMint.supply.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(
            vaultState.floatOutstanding.toString(),
            reportedFloatValue.toString()
        );
    });

    it("uses a lower reported float value when processing withdrawals", async () => {
        const depositAmount = 1_000_000;
        const withdrawnFloat = 200_000;
        const reportedFloatValue = 80_000;
        const sharesToWithdraw = 100_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createExternalUnderlyingTokenAccount(
            setup
        );

        await managerWithdraw(setup, withdrawnFloat, managerReceiverTokenAccount);
        await reportFloatValue(setup, reportedFloatValue);
        const accounts = await requestWithdraw(setup, 0, sharesToWithdraw);

        const totalAssetsAtProcessing =
            depositAmount - withdrawnFloat + reportedFloatValue;
        const expectedAssetsOut = sharesToAssetsDown(
            sharesToWithdraw,
            totalAssetsAtProcessing,
            depositAmount
        );

        await processWithdraw(setup, accounts);

        const userUnderlying = await fetchTokenAccount(
            setup.userUnderlyingTokenAccount
        );
        const shareMint = await fetchMint(setup.shareMint);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isTrue(expectedAssetsOut.lt(new anchor.BN(sharesToWithdraw)));
        assert.equal(userUnderlying.amount.toString(), expectedAssetsOut.toString());
        assert.equal(
            shareMint.supply.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
        assert.equal(
            vaultState.floatOutstanding.toString(),
            reportedFloatValue.toString()
        );
    });

    it("does not allow new manager withdrawals when reporting pushes the vault above the float cap", async () => {
        const depositAmount = 1_000_000;
        const withdrawnFloat = 200_000;
        const reportedFloatValue = 300_000;
        const setup = await setupVaultWithDeposit(depositAmount);
        const managerReceiverTokenAccount = await createExternalUnderlyingTokenAccount(
            setup
        );

        await managerWithdraw(setup, withdrawnFloat, managerReceiverTokenAccount);
        await reportFloatValue(setup, reportedFloatValue);

        try {
            await requestManagerWithdraw(setup, 1, managerReceiverTokenAccount);

            assert.fail("Expected request_manager_withdraw to enforce float cap");
        } catch (error) {
            assert.include(String(error), "FloatCapExceeded");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);

        assert.equal(
            vaultState.floatOutstanding.toString(),
            reportedFloatValue.toString()
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            (depositAmount - withdrawnFloat).toString()
        );
    });

    it("rejects reported values that would overflow total assets", async () => {
        const setup = await setupVaultWithDeposit(1_000_000);
        const maxU64 = new anchor.BN("18446744073709551615");

        try {
            await reportFloatValue(setup, maxU64);

            assert.fail("Expected report_float_value to reject total assets overflow");
        } catch (error) {
            assert.include(String(error), "MathOverflow");
        }
    });
});
