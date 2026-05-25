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
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

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
    deriveModuleEntryPda,
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./helpers/pda";
import { assertPublicKeyEquals } from "./helpers/assertions";
import { createTokenAccount, createUnderlyingMint } from "./helpers/token";

const kaminoYieldModuleProgram = anchor.workspace
    .kaminoYieldModule as Program<KaminoYieldModule>;

const MODULE_TYPE_TOKEN = 0;
const MODULE_TYPE_OBLIGATION = 1;
const INVALID_MODULE_TYPE = 99;
const OBLIGATION_ACCOUNT_SPACE = 96 + 8 * 88;
const KLEND_PROGRAM_ID = new PublicKey(
    "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

async function createKlendOwnedAccount(space = 8): Promise<PublicKey> {
    const account = Keypair.generate();
    const lamports = await connection.getMinimumBalanceForRentExemption(space);
    const transaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: manager,
            newAccountPubkey: account.publicKey,
            lamports,
            space,
            programId: KLEND_PROGRAM_ID,
        })
    );

    await sendAndConfirmTransaction(connection, transaction, [payer, account]);

    return account.publicKey;
}

type VaultSetup = {
    underlyingMint: PublicKey;
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    emergencyAdmin: Keypair;
};

async function setupVault(): Promise<VaultSetup> {
    const underlyingMint = await createUnderlyingMint();
    const emergencyAdmin = Keypair.generate();

    const [vault] = deriveVaultPda(underlyingMint);
    const [shareMint] = deriveShareMintPda(vault);
    const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

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

    return {
        underlyingMint,
        vault,
        shareMint,
        vaultTokenAccount,
        emergencyAdmin,
    };
}

type InitializeSetup = {
    vault: PublicKey;
    moduleConfig: PublicKey;
    moduleConfigBump: number;
    kaminoModuleState: PublicKey;
    kaminoModuleStateBump: number;
    lendingMarket: PublicKey;
    kaminoReserve: PublicKey;
};

function setupInitializeAccounts(): InitializeSetup {
    const vault = Keypair.generate().publicKey;
    const lendingMarket = Keypair.generate().publicKey;
    const kaminoReserve = Keypair.generate().publicKey;

    const [moduleConfig, moduleConfigBump] = deriveKaminoModuleConfigPda(
        vault,
        kaminoYieldModuleProgram.programId
    );
    const [kaminoModuleState, kaminoModuleStateBump] = deriveKaminoModuleStatePda(
        vault,
        kaminoYieldModuleProgram.programId
    );

    return {
        vault,
        moduleConfig,
        moduleConfigBump,
        kaminoModuleState,
        kaminoModuleStateBump,
        lendingMarket,
        kaminoReserve,
    };
}

async function initializeKaminoModule(
    setup: InitializeSetup,
    moduleType: number,
    obligation: PublicKey = PublicKey.default
): Promise<void> {
    await kaminoYieldModuleProgram.methods
        .initialize({
            vaultProgramId: program.programId,
            lendingMarket: setup.lendingMarket,
            kaminoReserve: setup.kaminoReserve,
            moduleType,
            obligation,
        })
        .accountsPartial({
            payer: manager,
            vault: setup.vault,
            moduleConfig: setup.moduleConfig,
            kaminoModuleState: setup.kaminoModuleState,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
}

describe("kamino_yield_module", () => {
    it("initializes a token-type module config and state", async () => {
        const setup = setupInitializeAccounts();

        await initializeKaminoModule(setup, MODULE_TYPE_TOKEN);

        const moduleConfig =
            await kaminoYieldModuleProgram.account.moduleConfig.fetch(
                setup.moduleConfig
            );
        const moduleState =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                setup.kaminoModuleState
            );

        assert.equal(moduleConfig.bump, setup.moduleConfigBump);
        assertPublicKeyEquals(moduleConfig.vault, setup.vault);
        assertPublicKeyEquals(moduleConfig.vaultProgramId, program.programId);
        assertPublicKeyEquals(moduleConfig.lendingMarket, setup.lendingMarket);
        assertPublicKeyEquals(moduleConfig.kaminoReserve, setup.kaminoReserve);
        assert.equal(moduleConfig.moduleType, MODULE_TYPE_TOKEN);
        assertPublicKeyEquals(moduleConfig.obligation, PublicKey.default);

        assert.equal(moduleState.bump, setup.kaminoModuleStateBump);
        assertPublicKeyEquals(moduleState.vault, setup.vault);
        assert.equal(moduleState.cachedNav.toString(), "0");
        assertPublicKeyEquals(moduleState.vaultProgramId, program.programId);
        assert.isTrue(moduleState.lastUpdatedSlot.gt(new anchor.BN(0)));
        assertPublicKeyEquals(moduleState.kaminoReserve, setup.kaminoReserve);
        assertPublicKeyEquals(moduleState.lendingMarket, setup.lendingMarket);
        assert.equal(moduleState.moduleType, MODULE_TYPE_TOKEN);
        assertPublicKeyEquals(moduleState.obligation, PublicKey.default);
        assert.isTrue(moduleState.isInitialized);
    });

    it("initializes an obligation-type module when obligation is provided", async () => {
        const setup = setupInitializeAccounts();
        const obligation = Keypair.generate().publicKey;

        await initializeKaminoModule(
            setup,
            MODULE_TYPE_OBLIGATION,
            obligation
        );

        const moduleConfig =
            await kaminoYieldModuleProgram.account.moduleConfig.fetch(
                setup.moduleConfig
            );
        const moduleState =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                setup.kaminoModuleState
            );

        assert.equal(moduleConfig.moduleType, MODULE_TYPE_OBLIGATION);
        assertPublicKeyEquals(moduleConfig.obligation, obligation);
        assert.equal(moduleState.moduleType, MODULE_TYPE_OBLIGATION);
        assertPublicKeyEquals(moduleState.obligation, obligation);
        assert.isTrue(moduleState.isInitialized);
    });

    it("rejects an invalid module type", async () => {
        const setup = setupInitializeAccounts();

        try {
            await initializeKaminoModule(setup, INVALID_MODULE_TYPE);

            assert.fail("Expected initialize to reject invalid module type");
        } catch (error) {
            assert.include(String(error), "InvalidModuleType");
        }
    });

    it("rejects obligation-type initialization with default obligation", async () => {
        const setup = setupInitializeAccounts();

        try {
            await initializeKaminoModule(setup, MODULE_TYPE_OBLIGATION);

            assert.fail("Expected initialize to reject default obligation");
        } catch (error) {
            assert.include(String(error), "InvalidObligation");
        }
    });

    it("calculates zero NAV when token position is empty", async () => {
        const setup = {
            ...setupInitializeAccounts(),
            kaminoReserve: await createKlendOwnedAccount(),
        };

        await initializeKaminoModule(setup, MODULE_TYPE_TOKEN);

        const collateralMint = await createUnderlyingMint();
        const vaultCollateralAccount = await createTokenAccount(
            collateralMint,
            setup.vault
        );
        const stateBefore =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                setup.kaminoModuleState
            );

        await kaminoYieldModuleProgram.methods
            .calculateNav()
            .accountsPartial({
                payer: manager,
                vault: setup.vault,
                kaminoModuleState: setup.kaminoModuleState,
                kaminoReserve: setup.kaminoReserve,
                vaultCollateralAccount,
                obligation: setup.kaminoReserve,
            })
            .rpc();

        const stateAfter =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                setup.kaminoModuleState
            );

        assert.equal(stateAfter.cachedNav.toString(), "0");
        assert.isTrue(
            stateAfter.lastUpdatedSlot.gte(stateBefore.lastUpdatedSlot)
        );
    });

    it("calculates zero NAV when obligation position is empty", async () => {
        const obligation = await createKlendOwnedAccount(
            OBLIGATION_ACCOUNT_SPACE
        );
        const setup = {
            ...setupInitializeAccounts(),
            kaminoReserve: await createKlendOwnedAccount(),
        };

        await initializeKaminoModule(
            setup,
            MODULE_TYPE_OBLIGATION,
            obligation
        );

        const collateralMint = await createUnderlyingMint();
        const vaultCollateralAccount = await createTokenAccount(
            collateralMint,
            setup.vault
        );
        const stateBefore =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                setup.kaminoModuleState
            );

        await kaminoYieldModuleProgram.methods
            .calculateNav()
            .accountsPartial({
                payer: manager,
                vault: setup.vault,
                kaminoModuleState: setup.kaminoModuleState,
                kaminoReserve: setup.kaminoReserve,
                vaultCollateralAccount,
                obligation,
            })
            .rpc();

        const stateAfter =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                setup.kaminoModuleState
            );

        assert.equal(stateAfter.cachedNav.toString(), "0");
        assert.isTrue(
            stateAfter.lastUpdatedSlot.gte(stateBefore.lastUpdatedSlot)
        );
    });

    it("registers and syncs Kamino module NAV through the vault", async () => {
        const vaultSetup = await setupVault();
        const baseSetup = setupInitializeAccounts();
        const [moduleConfig, moduleConfigBump] = deriveKaminoModuleConfigPda(
            vaultSetup.vault,
            kaminoYieldModuleProgram.programId
        );
        const [kaminoModuleState, kaminoModuleStateBump] = deriveKaminoModuleStatePda(
            vaultSetup.vault,
            kaminoYieldModuleProgram.programId
        );
        const setup: InitializeSetup = {
            ...baseSetup,
            vault: vaultSetup.vault,
            moduleConfig,
            moduleConfigBump,
            kaminoModuleState,
            kaminoModuleStateBump,
        };

        await initializeKaminoModule(setup, MODULE_TYPE_TOKEN);

        const moduleUnderlyingTokenAccount = await createTokenAccount(
            vaultSetup.underlyingMint,
            setup.kaminoModuleState,
            true
        );

        const policySeed = new anchor.BN(7);
        const [moduleEntry] = deriveModuleEntryPda(
            setup.vault,
            kaminoYieldModuleProgram.programId,
            policySeed
        );

        await program.methods
            .registerModule(policySeed)
            .accountsPartial({
                manager,
                vault: setup.vault,
                moduleEntry,
                moduleState: setup.kaminoModuleState,
                moduleUnderlyingTokenAccount,
                moduleProgram: kaminoYieldModuleProgram.programId,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        await program.methods
            .syncModuleNav()
            .accountsPartial({
                cranker: manager,
                vault: setup.vault,
                moduleEntry,
                moduleState: setup.kaminoModuleState,
                moduleProgram: kaminoYieldModuleProgram.programId,
            })
            .rpc();

        const moduleEntryState = await program.account.moduleEntry.fetch(
            moduleEntry
        );
        const vaultState = await program.account.vault.fetch(setup.vault);
        const moduleState =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                setup.kaminoModuleState
            );

        assertPublicKeyEquals(moduleState.vault, setup.vault);
        assert.equal(moduleState.cachedNav.toString(), "0");
        assertPublicKeyEquals(moduleState.vaultProgramId, program.programId);

        assertPublicKeyEquals(moduleEntryState.vault, setup.vault);
        assertPublicKeyEquals(
            moduleEntryState.moduleProgramId,
            kaminoYieldModuleProgram.programId
        );
        assert.equal(moduleEntryState.policySeed.toString(), policySeed.toString());
        assertPublicKeyEquals(moduleEntryState.moduleState, setup.kaminoModuleState);
        assertPublicKeyEquals(
            moduleEntryState.moduleUnderlyingTokenAccount,
            moduleUnderlyingTokenAccount
        );
        assert.equal(moduleEntryState.cachedNav.toString(), "0");
        assert.isTrue(moduleEntryState.navLastUpdatedSlot.gt(new anchor.BN(0)));
        assert.isTrue(moduleEntryState.isActive);
        assert.equal(vaultState.modulesNavTotal.toString(), "0");
        assert.equal(vaultState.moduleCount, 1);
    });

});
