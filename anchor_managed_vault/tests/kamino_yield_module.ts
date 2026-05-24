import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { KaminoYieldModule } from "../target/types/kamino_yield_module";
import {
    DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
    DEFAULT_MAX_FLOAT_BPS,
    manager,
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
import { createUnderlyingMint } from "./helpers/token";

const kaminoYieldModuleProgram = anchor.workspace
    .kaminoYieldModule as Program<KaminoYieldModule>;

const MODULE_TYPE_TOKEN = 0;
const MODULE_TYPE_OBLIGATION = 1;
const INVALID_MODULE_TYPE = 99;


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
    actingManager: PublicKey;
    lendingMarket: PublicKey;
    kaminoReserve: PublicKey;
};

function setupInitializeAccounts(): InitializeSetup {
    const vault = Keypair.generate().publicKey;
    const actingManager = Keypair.generate().publicKey;
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
        actingManager,
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
            actingManager: setup.actingManager,
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
        assertPublicKeyEquals(moduleConfig.actingManager, setup.actingManager);
        assertPublicKeyEquals(moduleConfig.lendingMarket, setup.lendingMarket);
        assertPublicKeyEquals(moduleConfig.kaminoReserve, setup.kaminoReserve);
        assert.equal(moduleConfig.moduleType, MODULE_TYPE_TOKEN);
        assertPublicKeyEquals(moduleConfig.obligation, PublicKey.default);

        assert.equal(moduleState.bump, setup.kaminoModuleStateBump);
        assertPublicKeyEquals(moduleState.vault, setup.vault);
        assert.equal(moduleState.cachedNav.toString(), "0");
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

        assertPublicKeyEquals(moduleEntryState.vault, setup.vault);
        assertPublicKeyEquals(
            moduleEntryState.moduleProgramId,
            kaminoYieldModuleProgram.programId
        );
        assert.equal(moduleEntryState.policySeed.toString(), policySeed.toString());
        assert.equal(moduleEntryState.cachedNav.toString(), "0");
        assert.isTrue(moduleEntryState.navLastUpdatedSlot.gt(new anchor.BN(0)));
        assert.isTrue(moduleEntryState.isActive);
        assert.equal(vaultState.modulesNavTotal.toString(), "0");
        assert.equal(vaultState.moduleCount, 1);
    });

});
