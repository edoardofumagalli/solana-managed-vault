import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
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
};

type TestUser = {
    publicKey: PublicKey;
    signer: Keypair | null;
    underlyingTokenAccount: PublicKey;
    shareTokenAccount: PublicKey;
};

type WithdrawAccounts = {
    userPosition: PublicKey;
    withdrawTicket: PublicKey;
    escrowShareTokenAccount: PublicKey;
};

async function fundUser(user: Keypair): Promise<void> {
    const signature = await connection.requestAirdrop(
        user.publicKey,
        LAMPORTS_PER_SOL
    );
    const latestBlockhash = await connection.getLatestBlockhash();

    await connection.confirmTransaction(
        {
            signature,
            ...latestBlockhash,
        },
        "confirmed"
    );
}

async function setupVault(
    maxFloatBps: number = DEFAULT_MAX_FLOAT_BPS
): Promise<VaultTestSetup> {
    const underlyingMint = await createUnderlyingMint();

    const [vault] = deriveVaultPda(underlyingMint);
    const [shareMint] = deriveShareMintPda(vault);
    const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

    await program.methods
        .initializeVault(maxFloatBps, manager)
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

    return {
        underlyingMint,
        vault,
        shareMint,
        vaultTokenAccount,
    };
}

async function createTestUser(
    setup: VaultTestSetup,
    initialUnderlyingAmount: number,
    signer: Keypair | null = null
): Promise<TestUser> {
    if (signer) {
        await fundUser(signer);
    }

    const publicKey = signer ? signer.publicKey : manager;
    const underlyingTokenAccount = await createTokenAccount(
        setup.underlyingMint,
        publicKey
    );
    const shareTokenAccount = await createTokenAccount(setup.shareMint, publicKey);

    if (initialUnderlyingAmount > 0) {
        await mintTokens(
            setup.underlyingMint,
            underlyingTokenAccount,
            initialUnderlyingAmount
        );
    }

    return {
        publicKey,
        signer,
        underlyingTokenAccount,
        shareTokenAccount,
    };
}

async function deposit(
    setup: VaultTestSetup,
    user: TestUser,
    amount: number
): Promise<void> {
    const builder = program.methods
        .deposit(new anchor.BN(amount))
        .accountsPartial({
            depositor: user.publicKey,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            depositorUnderlyingTokenAccount: user.underlyingTokenAccount,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            depositorShareTokenAccount: user.shareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (user.signer) {
        await builder.signers([user.signer]).rpc();
        return;
    }

    await builder.rpc();
}

function deriveWithdrawAccounts(
    vault: PublicKey,
    user: PublicKey,
    ticketIndex: number
): WithdrawAccounts {
    const [userPosition] = deriveUserVaultPositionPda(vault, user);
    const [withdrawTicket] = deriveWithdrawTicketPda(vault, user, ticketIndex);
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
    user: TestUser,
    ticketIndex: number,
    sharesAmount: number
): Promise<WithdrawAccounts> {
    const accounts = deriveWithdrawAccounts(
        setup.vault,
        user.publicKey,
        ticketIndex
    );

    const builder = program.methods
        .requestWithdraw(new anchor.BN(sharesAmount))
        .accountsPartial({
            user: user.publicKey,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            userShareTokenAccount: user.shareTokenAccount,
            userPosition: accounts.userPosition,
            withdrawTicket: accounts.withdrawTicket,
            escrowShareTokenAccount: accounts.escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        });

    if (user.signer) {
        await builder.signers([user.signer]).rpc();
        return accounts;
    }

    await builder.rpc();

    return accounts;
}

async function processWithdraw(
    setup: VaultTestSetup,
    user: TestUser,
    accounts: WithdrawAccounts
): Promise<void> {
    await program.methods
        .processWithdraw()
        .accountsPartial({
            user: user.publicKey,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            userUnderlyingTokenAccount: user.underlyingTokenAccount,
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

describe("lifecycle", () => {
    it("handles multiple users with interleaved withdrawals and proportional claims", async () => {
        const userADeposit = 1_000_000;
        const userBDeposit = 3_000_000;
        const donationAmount = 400_000;
        const userASharesToWithdraw = 500_000;
        const userBSharesToWithdraw = 1_500_000;

        const setup = await setupVault();
        const userA = await createTestUser(setup, userADeposit);
        const userB = await createTestUser(
            setup,
            userBDeposit,
            Keypair.generate()
        );

        await deposit(setup, userA, userADeposit);
        await deposit(setup, userB, userBDeposit);

        const donorTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );
        await mintTokens(setup.underlyingMint, donorTokenAccount, donationAmount);
        await transferTokens(
            donorTokenAccount,
            setup.vaultTokenAccount,
            donationAmount
        );

        const userAWithdrawAccounts = await requestWithdraw(
            setup,
            userA,
            0,
            userASharesToWithdraw
        );
        const userBWithdrawAccounts = await requestWithdraw(
            setup,
            userB,
            1,
            userBSharesToWithdraw
        );

        const totalAssetsBeforeProcessing =
            userADeposit + userBDeposit + donationAmount;
        const totalSharesBeforeProcessing = userADeposit + userBDeposit;
        const expectedUserAAssets = sharesToAssetsDown(
            userASharesToWithdraw,
            totalAssetsBeforeProcessing,
            totalSharesBeforeProcessing
        );
        const totalAssetsAfterUserA = totalAssetsBeforeProcessing -
            expectedUserAAssets.toNumber();
        const totalSharesAfterUserA = totalSharesBeforeProcessing -
            userASharesToWithdraw;
        const expectedUserBAssets = sharesToAssetsDown(
            userBSharesToWithdraw,
            totalAssetsAfterUserA,
            totalSharesAfterUserA
        );

        await processWithdraw(setup, userA, userAWithdrawAccounts);
        await processWithdraw(setup, userB, userBWithdrawAccounts);

        const userAUnderlying = await fetchTokenAccount(userA.underlyingTokenAccount);
        const userBUnderlying = await fetchTokenAccount(userB.underlyingTokenAccount);
        const userAShares = await fetchTokenAccount(userA.shareTokenAccount);
        const userBShares = await fetchTokenAccount(userB.shareTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const shareMint = await fetchMint(setup.shareMint);

        assert.equal(
            userAUnderlying.amount.toString(),
            expectedUserAAssets.toString()
        );
        assert.equal(
            userBUnderlying.amount.toString(),
            expectedUserBAssets.toString()
        );
        assert.equal(
            userAShares.amount.toString(),
            (userADeposit - userASharesToWithdraw).toString()
        );
        assert.equal(
            userBShares.amount.toString(),
            (userBDeposit - userBSharesToWithdraw).toString()
        );
        assert.equal(
            shareMint.supply.toString(),
            (
                totalSharesBeforeProcessing -
                userASharesToWithdraw -
                userBSharesToWithdraw
            ).toString()
        );
        assert.equal(
            vaultUnderlying.amount.toString(),
            new anchor.BN(totalAssetsBeforeProcessing)
                .sub(expectedUserAAssets)
                .sub(expectedUserBAssets)
                .toString()
        );
    });

    it("round-trips a 1 unit deposit and 1 share withdrawal without value leak", async () => {
        const depositAmount = 1;
        const sharesToWithdraw = 1;

        const setup = await setupVault();
        const user = await createTestUser(setup, depositAmount);

        await deposit(setup, user, depositAmount);
        const withdrawAccounts = await requestWithdraw(
            setup,
            user,
            0,
            sharesToWithdraw
        );
        await processWithdraw(setup, user, withdrawAccounts);

        const userUnderlying = await fetchTokenAccount(user.underlyingTokenAccount);
        const userShares = await fetchTokenAccount(user.shareTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const shareMint = await fetchMint(setup.shareMint);
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(userUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(userShares.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), "0");
        assert.equal(shareMint.supply.toString(), "0");
        assert.equal(vaultState.floatOutstanding.toString(), "0");
    });

    it("preserves the total_assets invariant across large deposits, float, and withdrawals", async () => {
        const depositAmount = 1_000_000_000;
        const floatAmount = 200_000_000;
        const sharesToWithdraw = 250_000_000;

        const setup = await setupVault();
        const user = await createTestUser(setup, depositAmount);
        const managerReceiver = Keypair.generate();
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            managerReceiver.publicKey
        );

        await deposit(setup, user, depositAmount);
        await managerWithdraw(setup, floatAmount, managerReceiverTokenAccount);

        let vaultState = await program.account.vault.fetch(setup.vault);
        let vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        let observedTotalAssets = new anchor.BN(
            vaultUnderlying.amount.toString()
        ).add(vaultState.floatOutstanding);

        assert.equal(observedTotalAssets.toString(), depositAmount.toString());

        const withdrawAccounts = await requestWithdraw(
            setup,
            user,
            0,
            sharesToWithdraw
        );
        const expectedAssetsOut = sharesToAssetsDown(
            sharesToWithdraw,
            depositAmount,
            depositAmount
        );

        await processWithdraw(setup, user, withdrawAccounts);

        vaultState = await program.account.vault.fetch(setup.vault);
        vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        observedTotalAssets = new anchor.BN(
            vaultUnderlying.amount.toString()
        ).add(vaultState.floatOutstanding);
        const shareMint = await fetchMint(setup.shareMint);

        assert.equal(
            observedTotalAssets.toString(),
            new anchor.BN(depositAmount).sub(expectedAssetsOut).toString()
        );
        assert.equal(vaultState.floatOutstanding.toString(), floatAmount.toString());
        assert.equal(
            shareMint.supply.toString(),
            (depositAmount - sharesToWithdraw).toString()
        );
    });

    it("allows user deposits while the vault is above the float cap", async () => {
        const initialDeposit = 1_000_000;
        const initialFloat = 200_000;
        const sharesToWithdraw = 600_000;
        const newDepositAmount = 100_000;

        const setup = await setupVault();
        const firstUser = await createTestUser(setup, initialDeposit);
        const secondUser = await createTestUser(
            setup,
            newDepositAmount,
            Keypair.generate()
        );
        const managerReceiver = Keypair.generate();
        const managerReceiverTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            managerReceiver.publicKey
        );

        await deposit(setup, firstUser, initialDeposit);
        await managerWithdraw(setup, initialFloat, managerReceiverTokenAccount);

        const withdrawAccounts = await requestWithdraw(
            setup,
            firstUser,
            0,
            sharesToWithdraw
        );
        const expectedAssetsOut = sharesToAssetsDown(
            sharesToWithdraw,
            initialDeposit,
            initialDeposit
        );
        await processWithdraw(setup, firstUser, withdrawAccounts);

        const totalAssetsBeforeSecondDeposit = new anchor.BN(initialDeposit)
            .sub(expectedAssetsOut)
            .toNumber();
        const totalSharesBeforeSecondDeposit = initialDeposit - sharesToWithdraw;
        const expectedSecondUserShares = new anchor.BN(newDepositAmount)
            .mul(new anchor.BN(totalSharesBeforeSecondDeposit + 1_000))
            .div(new anchor.BN(totalAssetsBeforeSecondDeposit + 1_000));

        await deposit(setup, secondUser, newDepositAmount);

        const secondUserShares = await fetchTokenAccount(secondUser.shareTokenAccount);
        const vaultUnderlying = await fetchTokenAccount(setup.vaultTokenAccount);
        const vaultState = await program.account.vault.fetch(setup.vault);
        const shareMint = await fetchMint(setup.shareMint);
        const observedTotalAssets = new anchor.BN(
            vaultUnderlying.amount.toString()
        ).add(vaultState.floatOutstanding);

        assert.equal(
            secondUserShares.amount.toString(),
            expectedSecondUserShares.toString()
        );
        assert.equal(vaultState.floatOutstanding.toString(), initialFloat.toString());
        assert.equal(
            observedTotalAssets.toString(),
            new anchor.BN(totalAssetsBeforeSecondDeposit)
                .add(new anchor.BN(newDepositAmount))
                .toString()
        );
        assert.equal(
            shareMint.supply.toString(),
            new anchor.BN(totalSharesBeforeSecondDeposit)
                .add(expectedSecondUserShares)
                .toString()
        );
    });
});
