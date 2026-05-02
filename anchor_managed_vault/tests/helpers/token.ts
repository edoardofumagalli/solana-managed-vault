import { PublicKey } from "@solana/web3.js";
import {
    createMint,
    getAccount,
    getMint,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { connection, payer, wallet } from "./setup";

// Test default for the underlying mint. initialize_vault copies this value to
// the share mint, making the initial 1:1 accounting easier to reason about.
export const DEFAULT_DECIMALS = 6;

// Creates the token mint that the vault will accept as its underlying asset.
// This is async because it sends a transaction to the local validator.
// payer is the Keypair that pays rent; wallet.publicKey becomes mint authority.
// TOKEN_PROGRAM_ID means we are creating a classic SPL Token mint for now.
export async function createUnderlyingMint(
    decimals: number = DEFAULT_DECIMALS
): Promise<PublicKey> {
    return createMint(
        connection,
        payer,
        wallet.publicKey,
        null,
        decimals,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
    );
}

// Reads a mint account from the validator via RPC.
// We will use this to verify share mint decimals and mint authority.
export async function fetchMint(mint: PublicKey) {
    return getMint(connection, mint, undefined, TOKEN_PROGRAM_ID);
}

// Reads a token account from the validator via RPC.
// We will use this to verify the vault token account mint and owner.
export async function fetchTokenAccount(tokenAccount: PublicKey) {
    return getAccount(connection, tokenAccount, undefined, TOKEN_PROGRAM_ID);
}
