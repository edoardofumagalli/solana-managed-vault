import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { MockYieldModule } from "../target/types/mock_yield_module";
import {
    connection,
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
import { createUnderlyingMint } from "./helpers/token";
import { assertPublicKeyEquals } from "./helpers/assertions";

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

type RegisteredModuleSetup = MockModuleSetup & {
    moduleEntry: PublicKey;
};

async function fundUser(user: Keypair): Promise<void> {
    const signature = await connection.requestAirdrop(
        user.publicKey,
        LAMPORTS_PER_SOL
    );
    const latestBlockhash = await connection.getLatestBlockhash();

    await connection.confirmTransaction(
        {
            signature,
            ...latestBlockhash,
        },
        "confirmed"
    );
}

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
        .initialize()
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
    setup: VaultSetup,
    policySeed: anchor.BN | number = 1
): Promise<RegisteredModuleSetup> {
    const mockModuleSetup = await setupMockModule(
        setup.vault,
        setup.underlyingMint
    );
    const [moduleEntry] = deriveModuleEntryPda(
        setup.vault,
        mockYieldModuleProgram.programId,
        policySeed
    );

    await program.methods
        .registerModule(new anchor.BN(policySeed))
        .accountsPartial({
            manager,
            vault: setup.vault,
            moduleEntry,
            moduleState: mockModuleSetup.mockModuleState,
            moduleUnderlyingTokenAccount: mockModuleSetup.moduleTokenAccount,
            moduleProgram: mockYieldModuleProgram.programId,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    return {
        ...mockModuleSetup,
        moduleEntry,
    };
}

describe("register_module", () => {
    it("registers an external module policy", async () => {
        const setup = await setupVault();
        const policySeed = new anchor.BN(1);
        const registeredModule = await registerModule(setup, policySeed);

        const moduleEntryState = await program.account.moduleEntry.fetch(
            registeredModule.moduleEntry
        );
        const vaultState = await program.account.vault.fetch(setup.vault);

        assertPublicKeyEquals(
            moduleEntryState.vault,
            setup.vault,
            "module entry vault mismatch"
        );
        assertPublicKeyEquals(
            moduleEntryState.moduleProgramId,
            mockYieldModuleProgram.programId,
            "module program mismatch"
        );
        assert.equal(moduleEntryState.policySeed.toString(), policySeed.toString());
        assertPublicKeyEquals(
            moduleEntryState.moduleState,
            registeredModule.mockModuleState
        );
        assertPublicKeyEquals(
            moduleEntryState.moduleUnderlyingTokenAccount,
            registeredModule.moduleTokenAccount
        );
        assert.equal(moduleEntryState.cachedNav.toString(), "0");
        assert.equal(moduleEntryState.navLastUpdatedSlot.toString(), "0");
        assert.isTrue(moduleEntryState.isActive);
        assert.equal(vaultState.moduleCount, 1);
        assert.equal(vaultState.modulesNavTotal.toString(), "0");
    });

    it("rejects registration from a non-manager", async () => {
        const setup = await setupVault();
        const nonManager = Keypair.generate();
        const policySeed = new anchor.BN(2);
        const [moduleEntry] = deriveModuleEntryPda(
            setup.vault,
            mockYieldModuleProgram.programId,
            policySeed
        );

        const mockModuleSetup = await setupMockModule(
            setup.vault,
            setup.underlyingMint
        );

        await fundUser(nonManager);

        try {
            await program.methods
                .registerModule(policySeed)
                .accountsPartial({
                    manager: nonManager.publicKey,
                    vault: setup.vault,
                    moduleEntry,
                    moduleState: mockModuleSetup.mockModuleState,
                    moduleUnderlyingTokenAccount: mockModuleSetup.moduleTokenAccount,
                    moduleProgram: mockYieldModuleProgram.programId,
                    systemProgram: SystemProgram.programId,
                })
                .signers([nonManager])
                .rpc();

            assert.fail("Expected registerModule to reject a non-manager");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);
        assert.equal(vaultState.moduleCount, 0);
    });

    it("rejects registering the same module policy twice", async () => {
        const setup = await setupVault();
        const policySeed = new anchor.BN(3);
        const registeredModule = await registerModule(setup, policySeed);

        try {
            await program.methods
                .registerModule(policySeed)
                .accountsPartial({
                    manager,
                    vault: setup.vault,
                    moduleEntry: registeredModule.moduleEntry,
                    moduleState: registeredModule.mockModuleState,
                    moduleUnderlyingTokenAccount: registeredModule.moduleTokenAccount,
                    moduleProgram: mockYieldModuleProgram.programId,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            assert.fail("Expected registerModule to reject duplicate module policy");
        } catch (error) {
            assert.match(String(error), /already in use|custom program error/i);
        }

        const vaultState = await program.account.vault.fetch(setup.vault);
        assert.equal(vaultState.moduleCount, 1);
    });

    it("blocks module registration during emergency shutdown", async () => {
        const setup = await setupVault();
        const policySeed = new anchor.BN(4);
        const [moduleEntry] = deriveModuleEntryPda(
            setup.vault,
            mockYieldModuleProgram.programId,
            policySeed
        );

        const mockModuleSetup = await setupMockModule(
            setup.vault,
            setup.underlyingMint
        );

        await program.methods
            .activateEmergencyShutdown()
            .accountsPartial({
                emergencyAdmin: setup.emergencyAdmin.publicKey,
                vault: setup.vault,
            })
            .signers([setup.emergencyAdmin])
            .rpc();

        try {
            await program.methods
                .registerModule(policySeed)
                .accountsPartial({
                    manager,
                    vault: setup.vault,
                    moduleEntry,
                    moduleState: mockModuleSetup.mockModuleState,
                    moduleUnderlyingTokenAccount: mockModuleSetup.moduleTokenAccount,
                    moduleProgram: mockYieldModuleProgram.programId,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            assert.fail("Expected registerModule to reject shutdown vault");
        } catch (error) {
            assert.include(String(error), "VaultShutdown");
        }

        const vaultState = await program.account.vault.fetch(setup.vault);
        assert.equal(vaultState.moduleCount, 0);
    });
});
