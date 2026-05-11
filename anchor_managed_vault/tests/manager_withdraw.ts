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
    deriveManagerWithdrawRequestPda,
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

const ZERO_DELAY = new anchor.BN(0);
const LONG_DELAY = new anchor.BN(1_000);

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
    maxFloatBps: number = DEFAULT_MAX_FLOAT_BPS,
    managerWithdrawDelaySlots: anchor.BN = ZERO_DELAY
): Promise<VaultTestSetup> {
    const underlyingMint = await createUnderlyingMint();

    const [vault] = deriveVaultPda(underlyingMint);
    const [shareMint] = deriveShareMintPda(vault);
    const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

    await program.methods
        .initializeVault(maxFloatBps, manager, managerWithdrawDelaySlots)
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilSlot(targetSlot: anchor.BN): Promise<void> {
    while (new anchor.BN(await connection.getSlot()).lt(targetSlot)) {
        await sleep(250);
    }
}

async function requestManagerWithdraw(
    setup: VaultTestSetup,
    amount: number,
    receiverUnderlyingTokenAccount: PublicKey,
    signer: Keypair | null = null,
    managerAccount: PublicKey = manager
): Promise<PublicKey> {
    const vaultState = await program.account.vault.fetch(setup.vault);
    const [managerWithdrawRequest] = deriveManagerWithdrawRequestPda(
        setup.vault,
        vaultState.nextManagerWithdrawRequestId
    );

    const builder = program.methods
        .requestManagerWithdraw(new anchor.BN(amount))
        .accountsPartial({
            manager: managerAccount,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            receiverUnderlyingTokenAccount,
            managerWithdrawRequest,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
    } else {
        await builder.rpc();
    }

    return managerWithdrawRequest;
}

async function executeManagerWithdraw(
    setup: VaultTestSetup,
    managerWithdrawRequest: PublicKey,
    receiverUnderlyingTokenAccount: PublicKey,
    signer: Keypair | null = null,
    executor: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .executeManagerWithdraw()
        .accountsPartial({
            executor,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            receiverUnderlyingTokenAccount,
            managerWithdrawRequest,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
}

async function requestAndExecuteManagerWithdraw(
    setup: VaultTestSetup,
    amount: number,
    receiverUnderlyingTokenAccount: PublicKey,
    signer: Keypair | null = null,
    managerAccount: PublicKey = manager
): Promise<PublicKey> {
    const managerWithdrawRequest = await requestManagerWithdraw(
        setup,
        amount,
        receiverUnderlyingTokenAccount,
        signer,
        managerAccount
    );
    const requestState = await program.account.managerWithdrawRequest.fetch(
        managerWithdrawRequest
    );

    await waitUntilSlot(requestState.executableAfterSlot);
    await executeManagerWithdraw(
        setup,
        managerWithdrawRequest,
        receiverUnderlyingTokenAccount,
        signer,
        managerAccount
    );

    return managerWithdrawRequest;
}

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
