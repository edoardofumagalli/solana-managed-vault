import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountIdempotent,
    createMint,
    getAccount,
    getAssociatedTokenAddressSync,
    getMint,
    mintTo,
} from "@solana/spl-token";

import { AnchorManagedVault } from "../target/types/anchor_managed_vault";

const VAULT_SEED = Buffer.from("vault");
const SHARE_MINT_SEED = Buffer.from("share_mint");
const WITHDRAW_TICKET_SEED = Buffer.from("withdraw_ticket");
const USER_VAULT_POSITION_SEED = Buffer.from("user_vault_position");
const ESCROW_SHARE_SEED = Buffer.from("escrow_share");

const DEFAULT_DECIMALS = 6;
const DEFAULT_MAX_FLOAT_BPS = 2_000;
const DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS = new anchor.BN(8);
const DEPOSIT_AMOUNT = 1_000_000;
const SHARES_TO_WITHDRAW = 250_000;

function deriveVaultPda(
    programId: PublicKey,
    underlyingMint: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [VAULT_SEED, underlyingMint.toBuffer()],
        programId
    );
}

function deriveShareMintPda(
    programId: PublicKey,
    vault: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SHARE_MINT_SEED, vault.toBuffer()],
        programId
    );
}

function deriveWithdrawTicketPda(
    programId: PublicKey,
    vault: PublicKey,
    user: PublicKey,
    ticketIndex: number | anchor.BN
): [PublicKey, number] {
    const ticketIndexSeed = new anchor.BN(ticketIndex).toArrayLike(
        Buffer,
        "le",
        8
    );

    return PublicKey.findProgramAddressSync(
        [
            WITHDRAW_TICKET_SEED,
            vault.toBuffer(),
            user.toBuffer(),
            ticketIndexSeed,
        ],
        programId
    );
}

function deriveUserVaultPositionPda(
    programId: PublicKey,
    vault: PublicKey,
    user: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [USER_VAULT_POSITION_SEED, vault.toBuffer(), user.toBuffer()],
        programId
    );
}

function deriveEscrowShareTokenAccountPda(
    programId: PublicKey,
    withdrawTicket: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [ESCROW_SHARE_SEED, withdrawTicket.toBuffer()],
        programId
    );
}

function formatAddress(label: string, address: PublicKey): void {
    console.log(`${label}: ${address.toBase58()}`);
}

async function printVaultSnapshot(
    program: Program<AnchorManagedVault>,
    vault: PublicKey,
    vaultTokenAccount: PublicKey,
    shareMint: PublicKey
): Promise<void> {
    const vaultState = await program.account.vault.fetch(vault);
    const vaultUnderlying = await getAccount(
        program.provider.connection,
        vaultTokenAccount,
        undefined,
        TOKEN_PROGRAM_ID
    );
    const shareMintAccount = await getMint(
        program.provider.connection,
        shareMint,
        undefined,
        TOKEN_PROGRAM_ID
    );
    const totalAssets = new anchor.BN(vaultUnderlying.amount.toString()).add(
        vaultState.floatOutstanding
    );

    console.log("\nVault snapshot");
    console.log(`vault underlying balance: ${vaultUnderlying.amount.toString()}`);
    console.log(`float outstanding: ${vaultState.floatOutstanding.toString()}`);
    console.log(`total assets: ${totalAssets.toString()}`);
    console.log(`share supply: ${shareMintAccount.supply.toString()}`);
    console.log(`total tickets: ${vaultState.totalTickets.toString()}`);
    console.log(`next ticket to process: ${vaultState.nextTicketToProcess.toString()}`);
}

async function main(): Promise<void> {
    anchor.setProvider(anchor.AnchorProvider.env());

    const provider = anchor.getProvider() as AnchorProvider;
    const wallet = provider.wallet;
    const payer = (wallet as typeof wallet & { payer?: Keypair }).payer;

    if (!payer) {
        throw new Error(
            "This playground expects AnchorProvider.env() to use a local Keypair wallet."
        );
    }

    const program = anchor.workspace
        .anchorManagedVault as Program<AnchorManagedVault>;
    const connection = provider.connection;
    const manager = wallet.publicKey;

    console.log("Managed vault playground");
    console.log(`RPC endpoint: ${connection.rpcEndpoint}`);
    formatAddress("program", program.programId);
    formatAddress("manager", manager);

    const programAccount = await connection.getAccountInfo(program.programId);
    if (!programAccount) {
        throw new Error(
            "Program account not found on the selected cluster. Deploy the program before running the playground."
        );
    }

    console.log("\nCreating test underlying mint...");
    const underlyingMint = await createMint(
        connection,
        payer,
        manager,
        null,
        DEFAULT_DECIMALS,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
    );

    const [vault] = deriveVaultPda(program.programId, underlyingMint);
    const [shareMint] = deriveShareMintPda(program.programId, vault);
    const vaultTokenAccount = getAssociatedTokenAddressSync(
        underlyingMint,
        vault,
        true,
        TOKEN_PROGRAM_ID
    );

    formatAddress("underlying mint", underlyingMint);
    formatAddress("vault", vault);
    formatAddress("share mint", shareMint);
    formatAddress("vault token account", vaultTokenAccount);

    console.log("\nInitializing vault...");
    const initializeSignature = await program.methods
        .initializeVault(DEFAULT_MAX_FLOAT_BPS, manager, DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS)
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
    console.log(`initialize_vault tx: ${initializeSignature}`);

    const userUnderlyingTokenAccount =
        await createAssociatedTokenAccountIdempotent(
            connection,
            payer,
            underlyingMint,
            manager,
            undefined,
            TOKEN_PROGRAM_ID
        );
    const userShareTokenAccount = await createAssociatedTokenAccountIdempotent(
        connection,
        payer,
        shareMint,
        manager,
        undefined,
        TOKEN_PROGRAM_ID
    );

    console.log("\nMinting test underlying to manager...");
    const mintSignature = await mintTo(
        connection,
        payer,
        underlyingMint,
        userUnderlyingTokenAccount,
        payer,
        DEPOSIT_AMOUNT,
        [],
        undefined,
        TOKEN_PROGRAM_ID
    );
    console.log(`mint tx: ${mintSignature}`);

    console.log("\nDepositing into vault...");
    const depositSignature = await program.methods
        .deposit(new anchor.BN(DEPOSIT_AMOUNT))
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
    console.log(`deposit tx: ${depositSignature}`);
    await printVaultSnapshot(program, vault, vaultTokenAccount, shareMint);

    const ticketIndex = 0;
    const [userPosition] = deriveUserVaultPositionPda(
        program.programId,
        vault,
        manager
    );
    const [withdrawTicket] = deriveWithdrawTicketPda(
        program.programId,
        vault,
        manager,
        ticketIndex
    );
    const [escrowShareTokenAccount] = deriveEscrowShareTokenAccountPda(
        program.programId,
        withdrawTicket
    );

    console.log("\nRequesting withdraw...");
    const requestSignature = await program.methods
        .requestWithdraw(new anchor.BN(SHARES_TO_WITHDRAW))
        .accountsPartial({
            user: manager,
            vault,
            underlyingMint,
            shareMint,
            vaultTokenAccount,
            userShareTokenAccount,
            userPosition,
            withdrawTicket,
            escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
    console.log(`request_withdraw tx: ${requestSignature}`);

    console.log("\nProcessing withdraw...");
    const processSignature = await program.methods
        .processWithdraw()
        .accountsPartial({
            user: manager,
            vault,
            underlyingMint,
            shareMint,
            vaultTokenAccount,
            userUnderlyingTokenAccount,
            userPosition,
            withdrawTicket,
            escrowShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    console.log(`process_withdraw tx: ${processSignature}`);

    const userUnderlying = await getAccount(
        connection,
        userUnderlyingTokenAccount,
        undefined,
        TOKEN_PROGRAM_ID
    );
    const userShares = await getAccount(
        connection,
        userShareTokenAccount,
        undefined,
        TOKEN_PROGRAM_ID
    );

    await printVaultSnapshot(program, vault, vaultTokenAccount, shareMint);

    console.log("\nUser balances");
    console.log(`underlying: ${userUnderlying.amount.toString()}`);
    console.log(`shares: ${userShares.amount.toString()}`);

    console.log("\nPlayground completed.");
}

main().catch((error) => {
    console.error("Playground failed:");
    console.error(error);
    process.exit(1);
});
