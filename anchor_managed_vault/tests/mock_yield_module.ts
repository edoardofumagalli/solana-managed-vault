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
import { manager } from "./helpers/setup";
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchTokenAccount,
    mintTokens,
} from "./helpers/token";
import {
    deriveMockModuleAuthorityPda,
    deriveMockModuleStatePda,
} from "./helpers/pda";

const mockYieldModuleProgram = anchor.workspace
    .mockYieldModule as Program<MockYieldModule>;

type MockModuleSetup = {
    vault: PublicKey;
    vaultAuthority: Keypair;
    underlyingMint: PublicKey;
    mockModuleState: PublicKey;
    mockModuleAuthority: PublicKey;
    mockModuleAuthorityBump: number;
    moduleTokenAccount: PublicKey;
};

async function setupMockModule(): Promise<MockModuleSetup> {
    const underlyingMint = await createUnderlyingMint();
    const vaultAuthority = Keypair.generate();
    const vault = vaultAuthority.publicKey;

    const [mockModuleState] = deriveMockModuleStatePda(
        vault,
        mockYieldModuleProgram.programId
    );
    const [mockModuleAuthority, mockModuleAuthorityBump] = deriveMockModuleAuthorityPda(
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
        vault,
        vaultAuthority,
        underlyingMint,
        mockModuleState,
        mockModuleAuthority,
        mockModuleAuthorityBump,
        moduleTokenAccount,
    };
}

describe("mock_yield_module", () => {
    it("initializes module state and module token account", async () => {
        const setup = await setupMockModule();

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(state.vault.toString(), setup.vault.toString());
        assert.equal(state.cachedNav.toString(), "0");
        assert.isTrue(state.lastUpdatedSlot.gt(new anchor.BN(0)));
        assert.equal(
            state.underlyingMint.toString(),
            setup.underlyingMint.toString()
        );
        assert.equal(
            state.moduleTokenAccount.toString(),
            setup.moduleTokenAccount.toString()
        );
        assert.equal(state.moduleAuthorityBump, setup.mockModuleAuthorityBump);
        assert.isTrue(state.isInitialized);

        assert.equal(
            moduleTokenAccount.mint.toString(),
            setup.underlyingMint.toString()
        );
        assert.equal(
            moduleTokenAccount.owner.toString(),
            setup.mockModuleAuthority.toString()
        );
        assert.equal(moduleTokenAccount.amount.toString(), "0");
    });

    it("calculates NAV from the module token account balance", async () => {
        const setup = await setupMockModule();
        const navAmount = 123_000;

        await mintTokens(
            setup.underlyingMint,
            setup.moduleTokenAccount,
            navAmount
        );

        await mockYieldModuleProgram.methods
            .calculateNav()
            .accountsPartial({
                payer: manager,
                mockModuleState: setup.mockModuleState,
                moduleTokenAccount: setup.moduleTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const moduleTokenAccount = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(moduleTokenAccount.amount.toString(), navAmount.toString());
        assert.equal(state.cachedNav.toString(), navAmount.toString());
        assert.isTrue(state.lastUpdatedSlot.gt(new anchor.BN(0)));
    });

    it("deposits tokens into the module and updates cached NAV", async () => {
        const setup = await setupMockModule();
        const depositAmount = 250_000;
        const vaultTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            setup.vault
        );

        await mintTokens(setup.underlyingMint, vaultTokenAccount, depositAmount);

        await mockYieldModuleProgram.methods
            .deposit(new anchor.BN(depositAmount))
            .accountsPartial({
                vaultAuthority: setup.vault,
                mockModuleState: setup.mockModuleState,
                underlyingMint: setup.underlyingMint,
                vaultTokenAccount,
                moduleTokenAccount: setup.moduleTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([setup.vaultAuthority])
            .rpc();

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const vaultTokenState = await fetchTokenAccount(vaultTokenAccount);
        const moduleTokenState = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenState.amount.toString(), "0");
        assert.equal(
            moduleTokenState.amount.toString(),
            depositAmount.toString()
        );
        assert.equal(state.cachedNav.toString(), depositAmount.toString());
        assert.isTrue(state.lastUpdatedSlot.gt(new anchor.BN(0)));
    });

    it("rejects deposit with zero amount", async () => {
        const setup = await setupMockModule();
        const vaultTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            setup.vault
        );

        await mintTokens(setup.underlyingMint, vaultTokenAccount, 1_000);

        try {
            await mockYieldModuleProgram.methods
                .deposit(new anchor.BN(0))
                .accountsPartial({
                    vaultAuthority: setup.vault,
                    mockModuleState: setup.mockModuleState,
                    underlyingMint: setup.underlyingMint,
                    vaultTokenAccount,
                    moduleTokenAccount: setup.moduleTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([setup.vaultAuthority])
                .rpc();

            assert.fail("Expected deposit to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const moduleTokenState = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(moduleTokenState.amount.toString(), "0");
        assert.equal(state.cachedNav.toString(), "0");
    });

    it("rejects deposit from an unauthorized vault authority", async () => {
        const setup = await setupMockModule();
        const wrongVaultAuthority = Keypair.generate();
        const wrongVaultTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            wrongVaultAuthority.publicKey
        );

        await mintTokens(
            setup.underlyingMint,
            wrongVaultTokenAccount,
            10_000
        );

        try {
            await mockYieldModuleProgram.methods
                .deposit(new anchor.BN(10_000))
                .accountsPartial({
                    vaultAuthority: wrongVaultAuthority.publicKey,
                    mockModuleState: setup.mockModuleState,
                    underlyingMint: setup.underlyingMint,
                    vaultTokenAccount: wrongVaultTokenAccount,
                    moduleTokenAccount: setup.moduleTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([wrongVaultAuthority])
                .rpc();

            assert.fail("Expected deposit to reject an unauthorized vault authority");
        } catch (error) {
            assert.include(String(error), "UnauthorizedVault");
        }

        const moduleTokenState = await fetchTokenAccount(
            setup.moduleTokenAccount
        );
        assert.equal(moduleTokenState.amount.toString(), "0");
    });

    it("rejects deposit into a different module token account", async () => {
        const setup = await setupMockModule();
        const vaultTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            setup.vault
        );
        const wrongModuleTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        await mintTokens(setup.underlyingMint, vaultTokenAccount, 10_000);

        try {
            await mockYieldModuleProgram.methods
                .deposit(new anchor.BN(10_000))
                .accountsPartial({
                    vaultAuthority: setup.vault,
                    mockModuleState: setup.mockModuleState,
                    underlyingMint: setup.underlyingMint,
                    vaultTokenAccount,
                    moduleTokenAccount: wrongModuleTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([setup.vaultAuthority])
                .rpc();

            assert.fail("Expected deposit to reject an unexpected module token account");
        } catch (error) {
            assert.include(String(error), "InvalidTokenAccount");
        }

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const expectedModuleTokenState = await fetchTokenAccount(
            setup.moduleTokenAccount
        );
        const wrongModuleTokenState = await fetchTokenAccount(
            wrongModuleTokenAccount
        );

        assert.equal(expectedModuleTokenState.amount.toString(), "0");
        assert.equal(wrongModuleTokenState.amount.toString(), "0");
        assert.equal(state.cachedNav.toString(), "0");
    });

    it("rejects calculate_nav with a different token account", async () => {
        const setup = await setupMockModule();
        const wrongTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            manager
        );

        try {
            await mockYieldModuleProgram.methods
                .calculateNav()
                .accountsPartial({
                    payer: manager,
                    mockModuleState: setup.mockModuleState,
                    moduleTokenAccount: wrongTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            assert.fail("Expected calculate_nav to reject an unexpected token account");
        } catch (error) {
            assert.include(String(error), "InvalidTokenAccount");
        }

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );

        assert.equal(state.cachedNav.toString(), "0");
    });
});
