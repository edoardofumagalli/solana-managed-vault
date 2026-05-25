import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { MockYieldModule } from "../target/types/mock_yield_module";
import {
    DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
    DEFAULT_MAX_FLOAT_BPS,
    manager,
    program,
} from "./helpers/setup";
import {
    deriveMockModuleAuthorityPda,
    deriveMockModuleStatePda,
    deriveModuleEntryPda,
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./helpers/pda";
import { createUnderlyingMint, mintTokens } from "./helpers/token";

const mockYieldModuleProgram = anchor.workspace
    .mockYieldModule as Program<MockYieldModule>;

type VaultSetup = {
    underlyingMint: PublicKey;
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    emergencyAdmin: Keypair;
};

type MockModuleSetup = {
    mockModuleState: PublicKey;
    mockModuleAuthority: PublicKey;
    moduleTokenAccount: PublicKey;
};

type RegisteredModuleSetup = VaultSetup & MockModuleSetup & {
    moduleEntry: PublicKey;
    policySeed: anchor.BN;
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

async function setupMockModule(
    vault: PublicKey,
    underlyingMint: PublicKey
): Promise<MockModuleSetup> {
    const [mockModuleState] = deriveMockModuleStatePda(
        vault,
        mockYieldModuleProgram.programId
    );
    const [mockModuleAuthority] = deriveMockModuleAuthorityPda(
        mockModuleState,
        mockYieldModuleProgram.programId
    );
    const moduleTokenAccount = getAssociatedTokenAddressSync(
        underlyingMint,
        mockModuleAuthority,
        true,
        TOKEN_PROGRAM_ID
    );

    await mockYieldModuleProgram.methods
        .initialize(program.programId)
        .accountsPartial({
            payer: manager,
            vault,
            underlyingMint,
            mockModuleState,
            mockModuleAuthority,
            moduleTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    return {
        mockModuleState,
        mockModuleAuthority,
        moduleTokenAccount,
    };
}

async function registerModule(
    vault: PublicKey,
    policySeed: anchor.BN,
    moduleState: PublicKey,
    moduleUnderlyingTokenAccount: PublicKey
): Promise<PublicKey> {
    const [moduleEntry] = deriveModuleEntryPda(
        vault,
        mockYieldModuleProgram.programId,
        policySeed
    );

    await program.methods
        .registerModule(policySeed)
        .accountsPartial({
            manager,
            vault,
            moduleEntry,
            moduleState,
            moduleUnderlyingTokenAccount,
            moduleProgram: mockYieldModuleProgram.programId,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    return moduleEntry;
}

async function setupRegisteredModule(
    policySeed: anchor.BN = new anchor.BN(1)
): Promise<RegisteredModuleSetup> {
    const vaultSetup = await setupVault();
    const mockModuleSetup = await setupMockModule(
        vaultSetup.vault,
        vaultSetup.underlyingMint
    );
    const moduleEntry = await registerModule(
        vaultSetup.vault,
        policySeed,
        mockModuleSetup.mockModuleState,
        mockModuleSetup.moduleTokenAccount
    );

    return {
        ...vaultSetup,
        ...mockModuleSetup,
        moduleEntry,
        policySeed,
    };
}

async function calculateMockNav(setup: MockModuleSetup): Promise<void> {
    await mockYieldModuleProgram.methods
        .calculateNav()
        .accountsPartial({
            payer: manager,
            mockModuleState: setup.mockModuleState,
            moduleTokenAccount: setup.moduleTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
}

async function syncModuleNav(setup: RegisteredModuleSetup): Promise<void> {
    await program.methods
        .syncModuleNav()
        .accountsPartial({
            cranker: manager,
            vault: setup.vault,
            moduleEntry: setup.moduleEntry,
            moduleState: setup.mockModuleState,
            moduleProgram: mockYieldModuleProgram.programId,
        })
        .rpc();
}

describe("sync_module_nav", () => {
    it("syncs cached NAV from a registered module state", async () => {
        const setup = await setupRegisteredModule();
        const navAmount = 123_000;

        await mintTokens(
            setup.underlyingMint,
            setup.moduleTokenAccount,
            navAmount
        );
        await calculateMockNav(setup);
        await syncModuleNav(setup);

        const moduleEntryState = await program.account.moduleEntry.fetch(
            setup.moduleEntry
        );
        const vaultState = await program.account.vault.fetch(setup.vault);
        const mockModuleState = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );

        assert.equal(mockModuleState.cachedNav.toString(), navAmount.toString());
        assert.equal(moduleEntryState.cachedNav.toString(), navAmount.toString());
        assert.isTrue(moduleEntryState.navLastUpdatedSlot.gt(new anchor.BN(0)));
        assert.equal(vaultState.modulesNavTotal.toString(), navAmount.toString());
    });

    it("replaces previous cached NAV instead of accumulating it twice", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(2));

        await mintTokens(setup.underlyingMint, setup.moduleTokenAccount, 100_000);
        await calculateMockNav(setup);
        await syncModuleNav(setup);

        let moduleEntryState = await program.account.moduleEntry.fetch(
            setup.moduleEntry
        );
        let vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(moduleEntryState.cachedNav.toString(), "100000");
        assert.equal(vaultState.modulesNavTotal.toString(), "100000");

        await mintTokens(setup.underlyingMint, setup.moduleTokenAccount, 50_000);
        await calculateMockNav(setup);
        await syncModuleNav(setup);

        moduleEntryState = await program.account.moduleEntry.fetch(
            setup.moduleEntry
        );
        vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(moduleEntryState.cachedNav.toString(), "150000");
        assert.equal(vaultState.modulesNavTotal.toString(), "150000");
    });

    it("rejects a module state not owned by the registered module program", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(3));

        try {
            await program.methods
                .syncModuleNav()
                .accountsPartial({
                    cranker: manager,
                    vault: setup.vault,
                    moduleEntry: setup.moduleEntry,
                    moduleState: program.programId,
                    moduleProgram: mockYieldModuleProgram.programId,
                })
                .rpc();

            assert.fail("Expected syncModuleNav to reject wrong module state owner");
        } catch (error) {
            assert.include(String(error), "InvalidModuleState");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);
        assert.equal(vaultState.modulesNavTotal.toString(), "0");
    });

    it("rejects a valid module state belonging to another vault", async () => {
        const setupA = await setupRegisteredModule(new anchor.BN(4));
        const setupB = await setupVault();
        const mockModuleB = await setupMockModule(
            setupB.vault,
            setupB.underlyingMint
        );

        await mintTokens(setupB.underlyingMint, mockModuleB.moduleTokenAccount, 80_000);
        await calculateMockNav(mockModuleB);

        try {
            await program.methods
                .syncModuleNav()
                .accountsPartial({
                    cranker: manager,
                    vault: setupA.vault,
                    moduleEntry: setupA.moduleEntry,
                    moduleState: mockModuleB.mockModuleState,
                    moduleProgram: mockYieldModuleProgram.programId,
                })
                .rpc();

            assert.fail("Expected syncModuleNav to reject another vault module state");
        } catch (error) {
            assert.include(String(error), "InvalidModuleState");
        }

        const moduleEntryState = await program.account.moduleEntry.fetch(
            setupA.moduleEntry
        );
        const vaultState = await program.account.vault.fetch(setupA.vault);

        assert.equal(moduleEntryState.cachedNav.toString(), "0");
        assert.equal(vaultState.modulesNavTotal.toString(), "0");
    });

    it("rejects a module program that does not match the module entry PDA", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(5));

        try {
            await program.methods
                .syncModuleNav()
                .accountsPartial({
                    cranker: manager,
                    vault: setup.vault,
                    moduleEntry: setup.moduleEntry,
                    moduleState: setup.mockModuleState,
                    moduleProgram: program.programId,
                })
                .rpc();

            assert.fail("Expected syncModuleNav to reject wrong module program");
        } catch (error) {
            assert.match(String(error), /ConstraintSeeds|seeds constraint/i);
        }
    });
});
