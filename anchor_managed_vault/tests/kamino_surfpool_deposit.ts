import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import {
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createSyncNativeInstruction,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { KaminoYieldModule } from "../target/types/kamino_yield_module";
import {
    DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
    DEFAULT_MAX_FLOAT_BPS,
    connection,
    manager,
    payer,
    program,
} from "./helpers/setup";
import {
    deriveKaminoModuleConfigPda,
    deriveKaminoModuleStatePda,
    deriveModuleCallAuthorityPda,
    deriveModuleEntryPda,
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./helpers/pda";
import { assertPublicKeyEquals } from "./helpers/assertions";
import {
    createTokenAccount,
    fetchTokenAccount,
} from "./helpers/token";
import {
    KAMINO_MAIN_MARKET,
    KAMINO_SOL_ORACLE_ACCOUNTS,
    KAMINO_SOL_RESERVE,
    KAMINO_SOL_STATIC_ACCOUNTS,
    KAMINO_SOL_UNDERLYING_MINT,
    kaminoDepositRemainingAccounts,
} from "./fixtures/kamino";

const kaminoYieldModuleProgram = anchor.workspace
    .kaminoYieldModule as Program<KaminoYieldModule>;

const MODULE_TYPE_TOKEN = 0;
const RUN_SURFPOOL_KAMINO = process.env.RUN_SURFPOOL_KAMINO === "1";
const describeSurfpool = RUN_SURFPOOL_KAMINO ? describe : describe.skip;

const VAULT_DEPOSIT_AMOUNT = 100_000_000;
const MODULE_DEPLOY_AMOUNT = 10_000_000;
const POLICY_SEED = new anchor.BN(1);

async function accountExists(address: PublicKey): Promise<boolean> {
    return (await connection.getAccountInfo(address)) !== null;
}

async function wrapSol(destination: PublicKey, amount: number): Promise<void> {
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: destination,
            lamports: amount,
        }),
        createSyncNativeInstruction(destination, TOKEN_PROGRAM_ID)
    );

    await sendAndConfirmTransaction(connection, transaction, [payer]);
}

async function initializeVaultIfNeeded(
    vault: PublicKey,
    underlyingMint: PublicKey,
    shareMint: PublicKey,
    vaultTokenAccount: PublicKey
): Promise<void> {
    if (await accountExists(vault)) {
        return;
    }

    const emergencyAdmin = Keypair.generate();

    await program.methods
        .initializeVault(
            DEFAULT_MAX_FLOAT_BPS,
            emergencyAdmin.publicKey,
            DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS
        )
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
}

async function initializeKaminoModuleIfNeeded(
    vault: PublicKey,
    moduleConfig: PublicKey,
    kaminoModuleState: PublicKey
): Promise<void> {
    if (await accountExists(kaminoModuleState)) {
        return;
    }

    await kaminoYieldModuleProgram.methods
        .initialize({
            vaultProgramId: program.programId,
            lendingMarket: KAMINO_MAIN_MARKET,
            kaminoReserve: KAMINO_SOL_RESERVE,
            moduleType: MODULE_TYPE_TOKEN,
            obligation: PublicKey.default,
        })
        .accountsPartial({
            payer: manager,
            vault,
            moduleConfig,
            kaminoModuleState,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
}

async function registerKaminoModuleIfNeeded(
    vault: PublicKey,
    moduleEntry: PublicKey,
    kaminoModuleState: PublicKey,
    moduleUnderlyingTokenAccount: PublicKey
): Promise<void> {
    if (await accountExists(moduleEntry)) {
        return;
    }

    await program.methods
        .registerModule(POLICY_SEED)
        .accountsPartial({
            manager,
            vault,
            moduleEntry,
            moduleState: kaminoModuleState,
            moduleUnderlyingTokenAccount,
            moduleProgram: kaminoYieldModuleProgram.programId,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
}

describeSurfpool("kamino_yield_module Surfpool deposit", () => {
    it("deploys WSOL into the real Kamino SOL reserve through module deposit", async () => {
        const underlyingMint = KAMINO_SOL_UNDERLYING_MINT;
        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);
        const [moduleCallAuthority] = deriveModuleCallAuthorityPda(vault);
        const [moduleConfig] = deriveKaminoModuleConfigPda(
            vault,
            kaminoYieldModuleProgram.programId
        );
        const [kaminoModuleState] = deriveKaminoModuleStatePda(
            vault,
            kaminoYieldModuleProgram.programId
        );
        const [moduleEntry] = deriveModuleEntryPda(
            vault,
            kaminoYieldModuleProgram.programId,
            POLICY_SEED
        );

        await initializeVaultIfNeeded(
            vault,
            underlyingMint,
            shareMint,
            vaultTokenAccount
        );
        await initializeKaminoModuleIfNeeded(
            vault,
            moduleConfig,
            kaminoModuleState
        );

        const managerUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            manager
        );
        const managerShareTokenAccount = await createTokenAccount(
            shareMint,
            manager
        );
        const moduleUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            kaminoModuleState,
            true
        );
        const vaultCollateralAccount = await createTokenAccount(
            KAMINO_SOL_STATIC_ACCOUNTS.reserveCollateralMint,
            kaminoModuleState,
            true
        );

        await registerKaminoModuleIfNeeded(
            vault,
            moduleEntry,
            kaminoModuleState,
            moduleUnderlyingTokenAccount
        );

        await wrapSol(managerUnderlyingTokenAccount, VAULT_DEPOSIT_AMOUNT);

        await program.methods
            .deposit(new anchor.BN(VAULT_DEPOSIT_AMOUNT))
            .accountsPartial({
                depositor: manager,
                vault,
                underlyingMint,
                depositorUnderlyingTokenAccount: managerUnderlyingTokenAccount,
                shareMint,
                vaultTokenAccount,
                depositorShareTokenAccount: managerShareTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const vaultTokenBefore = await fetchTokenAccount(vaultTokenAccount);
        const moduleUnderlyingBefore = await fetchTokenAccount(
            moduleUnderlyingTokenAccount
        );
        const collateralBefore = await fetchTokenAccount(vaultCollateralAccount);
        const moduleStateBefore =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                kaminoModuleState
            );

        await program.methods
            .deployToModule(new anchor.BN(MODULE_DEPLOY_AMOUNT))
            .accountsPartial({
                manager,
                vault,
                moduleCallAuthority,
                moduleEntry,
                underlyingMint,
                vaultTokenAccount,
                moduleUnderlyingTokenAccount,
                moduleProgram: kaminoYieldModuleProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .remainingAccounts(
                kaminoDepositRemainingAccounts({
                    ...KAMINO_SOL_ORACLE_ACCOUNTS,
                    moduleConfig,
                    kaminoModuleState,
                    moduleUnderlyingTokenAccount,
                    vaultCollateralAccount,
                    vaultTokenAccount,
                })
            )
            .rpc();

        const vaultTokenAfter = await fetchTokenAccount(vaultTokenAccount);
        const moduleUnderlyingAfter = await fetchTokenAccount(
            moduleUnderlyingTokenAccount
        );
        const collateralAfter = await fetchTokenAccount(vaultCollateralAccount);
        const moduleStateAfter =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                kaminoModuleState
            );
        const moduleEntryState = await program.account.moduleEntry.fetch(
            moduleEntry
        );
        const vaultState = await program.account.vault.fetch(vault);

        assert.equal(
            vaultTokenAfter.amount.toString(),
            (vaultTokenBefore.amount - BigInt(MODULE_DEPLOY_AMOUNT)).toString()
        );
        assert.equal(
            moduleUnderlyingAfter.amount.toString(),
            moduleUnderlyingBefore.amount.toString(),
            "Kamino deposit should consume the staged WSOL transferred by the vault"
        );
        assert.isTrue(
            collateralAfter.amount > collateralBefore.amount,
            "Expected Kamino collateral token balance to increase"
        );
        assert.isTrue(
            moduleStateAfter.cachedNav.gt(moduleStateBefore.cachedNav),
            "Expected cached NAV to increase after depositing into Kamino"
        );
        assert.equal(
            moduleEntryState.cachedNav.toString(),
            moduleStateAfter.cachedNav.toString()
        );
        assert.equal(
            vaultState.modulesNavTotal.toString(),
            moduleStateAfter.cachedNav.toString()
        );
        assertPublicKeyEquals(moduleStateAfter.vault, vault);
        assertPublicKeyEquals(moduleStateAfter.kaminoReserve, KAMINO_SOL_RESERVE);
    });
});
