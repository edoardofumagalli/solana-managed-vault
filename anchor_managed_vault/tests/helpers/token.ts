import { PublicKey, Signer } from "@solana/web3.js";
import {
    createAssociatedTokenAccountIdempotent,
    createMint,
    getAccount,
    getMint,
    mintTo,
    TOKEN_PROGRAM_ID,
    transfer,
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

// Creates or reuses the associated token account for a mint/owner pair.
// Tests use this for the depositor underlying account and depositor share account.
export async function createTokenAccount(
    mint: PublicKey,
    owner: PublicKey,
    allowOwnerOffCurve = false
): Promise<PublicKey> {
    return createAssociatedTokenAccountIdempotent(
        connection,
        payer,
        mint,
        owner,
        undefined,
        TOKEN_PROGRAM_ID,
        undefined,
        allowOwnerOffCurve
    );
}

// Mints test tokens into an existing token account.
// This assumes createUnderlyingMint was used, so payer controls the mint authority.
export async function mintTokens(
    mint: PublicKey,
    destination: PublicKey,
    amount: number | bigint
) {
    return mintTo(
        connection,
        payer,
        mint,
        destination,
        payer,
        amount,
        [],
        undefined,
        TOKEN_PROGRAM_ID
    );
}

// Moves test tokens between token accounts owned by the provided signer.
// Useful for donation/rounding scenarios where we need direct SPL transfers.
export async function transferTokens(
    source: PublicKey,
    destination: PublicKey,
    amount: number | bigint,
    owner: Signer = payer
) {
    return transfer(
        connection,
        payer,
        source,
        destination,
        owner,
        amount,
        [],
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
