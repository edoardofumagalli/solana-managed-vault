import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { manager, program } from "./setup";
import {
    deriveEscrowShareTokenAccountPda,
    deriveUserVaultPositionPda,
    deriveWithdrawTicketPda,
} from "./pda";
import { VaultSetup } from "./vault";

export type WithdrawAccounts = {
    userPosition: PublicKey;
    withdrawTicket: PublicKey;
    escrowShareTokenAccount: PublicKey;
};

type WithdrawUserOptions = {
    user?: PublicKey;
    userSigner?: Keypair | null;
    userUnderlyingTokenAccount?: PublicKey;
    userShareTokenAccount?: PublicKey;
};

type SetupWithUserTokens = VaultSetup & {
    userUnderlyingTokenAccount?: PublicKey;
    userShareTokenAccount?: PublicKey;
};

function userShareTokenAccount(
    setup: SetupWithUserTokens,
    options: WithdrawUserOptions
): PublicKey {
    const tokenAccount = options.userShareTokenAccount ?? setup.userShareTokenAccount;

    if (!tokenAccount) {
        throw new Error("userShareTokenAccount is required");
    }

    return tokenAccount;
}

function userUnderlyingTokenAccount(
    setup: SetupWithUserTokens,
    options: WithdrawUserOptions
): PublicKey {
    const tokenAccount = options.userUnderlyingTokenAccount ?? setup.userUnderlyingTokenAccount;

    if (!tokenAccount) {
        throw new Error("userUnderlyingTokenAccount is required");
    }

    return tokenAccount;
}

export function deriveWithdrawAccounts(
    vault: PublicKey,
    userOrTicketIndex: PublicKey | number | anchor.BN,
    maybeTicketIndex?: number | anchor.BN
): WithdrawAccounts {
    const user = userOrTicketIndex instanceof PublicKey ? userOrTicketIndex : manager;
    const ticketIndex = userOrTicketIndex instanceof PublicKey
        ? maybeTicketIndex ?? 0
        : userOrTicketIndex;
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

export async function requestWithdraw(
    setup: SetupWithUserTokens,
    ticketIndex: number | anchor.BN,
    sharesAmount: number | bigint,
    options: WithdrawUserOptions = {}
): Promise<WithdrawAccounts> {
    const user = options.user ?? manager;
    const accounts = deriveWithdrawAccounts(setup.vault, user, ticketIndex);
    const builder = program.methods
        .requestWithdraw(new anchor.BN(sharesAmount.toString()))
        .accountsPartial({
            user,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            userShareTokenAccount: userShareTokenAccount(setup, options),
            userPosition: accounts.userPosition,
            withdrawTicket: accounts.withdrawTicket,
            escrowShareTokenAccount: accounts.escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        });

    if (options.userSigner) {
        await builder.signers([options.userSigner]).rpc();
        return accounts;
    }

    await builder.rpc();
    return accounts;
}

export async function processWithdraw(
    setup: SetupWithUserTokens,
    accounts: WithdrawAccounts,
    options: WithdrawUserOptions = {}
): Promise<void> {
    const user = options.user ?? manager;
    const builder = program.methods
        .processWithdraw()
        .accountsPartial({
            user,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            userUnderlyingTokenAccount: userUnderlyingTokenAccount(setup, options),
            userPosition: accounts.userPosition,
            withdrawTicket: accounts.withdrawTicket,
            escrowShareTokenAccount: accounts.escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (options.userSigner) {
        await builder.signers([options.userSigner]).rpc();
        return;
    }

    await builder.rpc();
}

export async function cancelWithdraw(
    setup: SetupWithUserTokens,
    accounts: WithdrawAccounts,
    options: WithdrawUserOptions = {}
): Promise<void> {
    const user = options.user ?? manager;
    const builder = program.methods
        .cancelWithdraw()
        .accountsPartial({
            user,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            shareMint: setup.shareMint,
            userShareTokenAccount: userShareTokenAccount(setup, options),
            userPosition: accounts.userPosition,
            withdrawTicket: accounts.withdrawTicket,
            escrowShareTokenAccount: accounts.escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (options.userSigner) {
        await builder.signers([options.userSigner]).rpc();
        return;
    }

    await builder.rpc();
}
