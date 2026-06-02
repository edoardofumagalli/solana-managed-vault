import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { connection, manager, program } from "./setup";
import { deriveManagerWithdrawRequestPda } from "./pda";
import { VaultSetup } from "./vault";

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilSlot(targetSlot: anchor.BN): Promise<void> {
    while (new anchor.BN(await connection.getSlot()).lt(targetSlot)) {
        await sleep(250);
    }
}

export async function requestManagerWithdraw(
    setup: VaultSetup,
    amount: number | bigint,
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
        .requestManagerWithdraw(new anchor.BN(amount.toString()))
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
        return managerWithdrawRequest;
    }

    await builder.rpc();
    return managerWithdrawRequest;
}

export async function executeManagerWithdraw(
    setup: VaultSetup,
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

export async function requestAndExecuteManagerWithdraw(
    setup: VaultSetup,
    amount: number | bigint,
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

export async function managerDeposit(
    setup: VaultSetup,
    amount: number | bigint,
    callerUnderlyingTokenAccount: PublicKey,
    signer: Keypair | null = null,
    caller: PublicKey = manager,
    vaultTokenAccount: PublicKey = setup.vaultTokenAccount,
    underlyingMint: PublicKey = setup.underlyingMint
): Promise<void> {
    const builder = program.methods
        .managerDeposit(new anchor.BN(amount.toString()))
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

export async function reportFloatValue(
    setup: VaultSetup,
    reportedFloatValue: number | bigint,
    signer: Keypair | null = null,
    managerAccount: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .reportFloatValue(new anchor.BN(reportedFloatValue.toString()))
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
