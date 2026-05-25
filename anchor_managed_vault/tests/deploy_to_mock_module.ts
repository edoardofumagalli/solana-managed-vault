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
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchTokenAccount,
    mintTokens,
} from "./helpers/token";

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

async function depositIntoVault(
    setup: VaultSetup,
    amount: number
): Promise<void> {
    const depositorUnderlyingTokenAccount = await createTokenAccount(
        setup.underlyingMint,
        manager
    );
    const depositorShareTokenAccount = await createTokenAccount(
        setup.shareMint,
        manager
    );

    await mintTokens(
        setup.underlyingMint,
        depositorUnderlyingTokenAccount,
        amount
    );

    await program.methods
        .deposit(new anchor.BN(amount))
        .accountsPartial({
            depositor: manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
            depositorUnderlyingTokenAccount,
            shareMint: setup.shareMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            depositorShareTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
}

async function deployToMockModule(
    setup: RegisteredModuleSetup,
    amount: number,
    signer: Keypair | null = null,
    signerPublicKey: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .deployToMockModule(new anchor.BN(amount))
        .accountsPartial({
            manager: signerPublicKey,
            vault: setup.vault,
            moduleEntry: setup.moduleEntry,
            mockModuleState: setup.mockModuleState,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            moduleTokenAccount: setup.moduleTokenAccount,
            mockYieldModuleProgram: mockYieldModuleProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
}

async function deployToGenericModule(
    setup: RegisteredModuleSetup,
    amount: number
): Promise<void> {
    await program.methods
        .deployToModule(new anchor.BN(amount))
        .accountsPartial({
            manager,
            vault: setup.vault,
            moduleEntry: setup.moduleEntry,
            underlyingMint: setup.underlyingMint,
            vaultTokenAccount: setup.vaultTokenAccount,
            moduleUnderlyingTokenAccount: setup.moduleTokenAccount,
            moduleProgram: mockYieldModuleProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
            {
                pubkey: setup.mockModuleState,
                isWritable: true,
                isSigner: false,
            },
            {
                pubkey: setup.moduleTokenAccount,
                isWritable: true,
                isSigner: false,
            },
        ])
        .rpc();
}


async function recallFromMockModule(
    setup: RegisteredModuleSetup,
    amount: number,
    signer: Keypair | null = null,
    signerPublicKey: PublicKey = manager
): Promise<void> {
    const builder = program.methods
        .recallFromMockModule(new anchor.BN(amount))
        .accountsPartial({
            manager: signerPublicKey,
            vault: setup.vault,
            moduleEntry: setup.moduleEntry,
            mockModuleState: setup.mockModuleState,
            mockModuleAuthority: setup.mockModuleAuthority,
            underlyingMint: setup.underlyingMint,
            moduleTokenAccount: setup.moduleTokenAccount,
            vaultTokenAccount: setup.vaultTokenAccount,
            mockYieldModuleProgram: mockYieldModuleProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        });

    if (signer) {
        await builder.signers([signer]).rpc();
        return;
    }

    await builder.rpc();
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

describe("deploy_to_mock_module", () => {
    it("deploys vault capital through the generic module interface and updates NAV atomically", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(11));
        const vaultDepositAmount = 1_000_000;
        const deployAmount = 200_000;

        await depositIntoVault(setup, vaultDepositAmount);
        await deployToGenericModule(setup, deployAmount);

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );
        const mockModuleState = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const moduleEntryState = await program.account.moduleEntry.fetch(
            setup.moduleEntry
        );
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(
            vaultTokenAccount.amount.toString(),
            (vaultDepositAmount - deployAmount).toString()
        );
        assert.equal(moduleTokenAccount.amount.toString(), deployAmount.toString());
        assert.equal(mockModuleState.cachedNav.toString(), deployAmount.toString());
        assert.equal(moduleEntryState.cachedNav.toString(), deployAmount.toString());
        assert.equal(vaultState.modulesNavTotal.toString(), deployAmount.toString());
    });

    it("deploys vault capital into the mock module and syncs NAV", async () => {
        const setup = await setupRegisteredModule();
        const vaultDepositAmount = 1_000_000;
        const deployAmount = 200_000;

        await depositIntoVault(setup, vaultDepositAmount);
        await deployToMockModule(setup, deployAmount);

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );
        const mockModuleState = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        let vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(
            vaultTokenAccount.amount.toString(),
            (vaultDepositAmount - deployAmount).toString()
        );
        assert.equal(moduleTokenAccount.amount.toString(), deployAmount.toString());
        assert.equal(mockModuleState.cachedNav.toString(), deployAmount.toString());
        assert.equal(vaultState.modulesNavTotal.toString(), "0");

        await syncModuleNav(setup);

        const moduleEntryState = await program.account.moduleEntry.fetch(
            setup.moduleEntry
        );
        vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(moduleEntryState.cachedNav.toString(), deployAmount.toString());
        assert.equal(vaultState.modulesNavTotal.toString(), deployAmount.toString());
    });

    it("rejects zero amount", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(2));

        await depositIntoVault(setup, 100_000);

        try {
            await deployToMockModule(setup, 0);

            assert.fail("Expected deploy_to_mock_module to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenAccount.amount.toString(), "100000");
        assert.equal(moduleTokenAccount.amount.toString(), "0");
    });

    it("rejects a non-manager", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(3));
        const nonManager = Keypair.generate();

        await depositIntoVault(setup, 100_000);

        try {
            await deployToMockModule(
                setup,
                10_000,
                nonManager,
                nonManager.publicKey
            );

            assert.fail("Expected deploy_to_mock_module to reject non-manager");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenAccount.amount.toString(), "100000");
        assert.equal(moduleTokenAccount.amount.toString(), "0");
    });

    it("rejects deploy amount above liquid vault balance", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(4));

        await depositIntoVault(setup, 100_000);

        try {
            await deployToMockModule(setup, 150_000);

            assert.fail("Expected deploy_to_mock_module to reject insufficient liquidity");
        } catch (error) {
            assert.include(String(error), "InsufficientLiquidity");
        }

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenAccount.amount.toString(), "100000");
        assert.equal(moduleTokenAccount.amount.toString(), "0");
    });



    it("recalls module capital back into the vault and syncs reduced NAV", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(6));
        const vaultDepositAmount = 1_000_000;
        const deployAmount = 200_000;
        const recallAmount = 75_000;
        const expectedRemainingModuleNav = deployAmount - recallAmount;

        await depositIntoVault(setup, vaultDepositAmount);
        await deployToMockModule(setup, deployAmount);
        await syncModuleNav(setup);
        await recallFromMockModule(setup, recallAmount);

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );
        const mockModuleState = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        let vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(
            vaultTokenAccount.amount.toString(),
            (vaultDepositAmount - deployAmount + recallAmount).toString()
        );
        assert.equal(
            moduleTokenAccount.amount.toString(),
            expectedRemainingModuleNav.toString()
        );
        assert.equal(
            mockModuleState.cachedNav.toString(),
            expectedRemainingModuleNav.toString()
        );
        assert.equal(vaultState.modulesNavTotal.toString(), deployAmount.toString());

        await syncModuleNav(setup);

        const moduleEntryState = await program.account.moduleEntry.fetch(
            setup.moduleEntry
        );
        vaultState = await program.account.vault.fetch(setup.vault);

        assert.equal(
            moduleEntryState.cachedNav.toString(),
            expectedRemainingModuleNav.toString()
        );
        assert.equal(
            vaultState.modulesNavTotal.toString(),
            expectedRemainingModuleNav.toString()
        );
    });

    it("rejects recall with zero amount", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(7));

        await depositIntoVault(setup, 100_000);
        await deployToMockModule(setup, 20_000);

        try {
            await recallFromMockModule(setup, 0);

            assert.fail("Expected recall_from_mock_module to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenAccount.amount.toString(), "80000");
        assert.equal(moduleTokenAccount.amount.toString(), "20000");
    });

    it("rejects recall from a non-manager", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(8));
        const nonManager = Keypair.generate();

        await depositIntoVault(setup, 100_000);
        await deployToMockModule(setup, 20_000);

        try {
            await recallFromMockModule(
                setup,
                10_000,
                nonManager,
                nonManager.publicKey
            );

            assert.fail("Expected recall_from_mock_module to reject non-manager");
        } catch (error) {
            assert.include(String(error), "UnauthorizedManager");
        }

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenAccount.amount.toString(), "80000");
        assert.equal(moduleTokenAccount.amount.toString(), "20000");
    });

    it("rejects recall above module liquidity", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(9));

        await depositIntoVault(setup, 100_000);
        await deployToMockModule(setup, 20_000);

        try {
            await recallFromMockModule(setup, 20_001);

            assert.fail("Expected recall_from_mock_module to reject insufficient liquidity");
        } catch (error) {
            assert.include(String(error), "InsufficientLiquidity");
        }

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenAccount.amount.toString(), "80000");
        assert.equal(moduleTokenAccount.amount.toString(), "20000");
    });

    it("allows recall during emergency shutdown", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(10));
        const vaultDepositAmount = 100_000;
        const deployAmount = 20_000;
        const recallAmount = 5_000;

        await depositIntoVault(setup, vaultDepositAmount);
        await deployToMockModule(setup, deployAmount);

        await program.methods
            .activateEmergencyShutdown()
            .accountsPartial({
                emergencyAdmin: setup.emergencyAdmin.publicKey,
                vault: setup.vault,
            })
            .signers([setup.emergencyAdmin])
            .rpc();

        await recallFromMockModule(setup, recallAmount);

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );
        const vaultState = await program.account.vault.fetch(setup.vault);

        assert.isTrue(vaultState.isShutdown);
        assert.equal(
            vaultTokenAccount.amount.toString(),
            (vaultDepositAmount - deployAmount + recallAmount).toString()
        );
        assert.equal(
            moduleTokenAccount.amount.toString(),
            (deployAmount - recallAmount).toString()
        );
    });

    it("rejects deploy amount above the configured float cap", async () => {
        const setup = await setupRegisteredModule(new anchor.BN(5));

        await depositIntoVault(setup, 1_000_000);

        try {
            await deployToMockModule(setup, 200_001);

            assert.fail("Expected deploy_to_mock_module to reject float cap breach");
        } catch (error) {
            assert.include(String(error), "FloatCapExceeded");
        }

        const vaultTokenAccount = await fetchTokenAccount(
            setup.vaultTokenAccount
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenAccount.amount.toString(), "1000000");
        assert.equal(moduleTokenAccount.amount.toString(), "0");
    });
});
