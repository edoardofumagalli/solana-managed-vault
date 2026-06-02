import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { manager, program } from "../../helpers/setup";
import { mintTokens } from "../../helpers/token";
import { setupVault } from "../../helpers/vault";
import {
    MockModuleSetup,
    RegisteredMockModuleSetup,
    mockYieldModuleProgram,
    setupMockModule as setupMockModuleShared,
    setupRegisteredMockModule,
} from "../../helpers/modules";

async function setupMockModule(
    vault: PublicKey,
    underlyingMint: PublicKey
): Promise<MockModuleSetup> {
    return setupMockModuleShared({ vault, underlyingMint });
}

async function setupRegisteredModule(
    policySeed: anchor.BN = new anchor.BN(1)
): Promise<RegisteredMockModuleSetup> {
    const vaultSetup = await setupVault();

    return setupRegisteredMockModule(vaultSetup, policySeed);
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

async function syncModuleNav(setup: RegisteredMockModuleSetup): Promise<void> {
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
