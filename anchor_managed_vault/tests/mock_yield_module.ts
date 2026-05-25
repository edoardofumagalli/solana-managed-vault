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
import { manager, program } from "./helpers/setup";
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchTokenAccount,
    mintTokens,
} from "./helpers/token";
import {
    deriveModuleCallAuthorityPda,
    deriveMockModuleAuthorityPda,
    deriveMockModuleStatePda,
} from "./helpers/pda";

const mockYieldModuleProgram = anchor.workspace
    .mockYieldModule as Program<MockYieldModule>;

type MockModuleSetup = {
    vault: PublicKey;
    underlyingMint: PublicKey;
    mockModuleState: PublicKey;
    moduleCallAuthority: PublicKey;
    mockModuleAuthority: PublicKey;
    mockModuleAuthorityBump: number;
    moduleTokenAccount: PublicKey;
};

async function setupMockModule(): Promise<MockModuleSetup> {
    const underlyingMint = await createUnderlyingMint();
    const vault = Keypair.generate().publicKey;
    const [moduleCallAuthority] = deriveModuleCallAuthorityPda(vault);

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
        vault,
        underlyingMint,
        mockModuleState,
        moduleCallAuthority,
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
        assert.equal(state.vaultProgramId.toString(), program.programId.toString());
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

    it("rejects direct deposit because only the vault program can sign module_call_authority", async () => {
        const setup = await setupMockModule();
        const depositAmount = 250_000;
        await mintTokens(
            setup.underlyingMint,
            setup.moduleTokenAccount,
            depositAmount
        );

        let rejected = false;
        try {
            await mockYieldModuleProgram.methods
                .deposit(new anchor.BN(depositAmount))
                .accountsPartial({
                    moduleCallAuthority: setup.moduleCallAuthority,
                    mockModuleState: setup.mockModuleState,
                    moduleTokenAccount: setup.moduleTokenAccount,
                })
                .rpc();

            assert.fail("Expected direct deposit to reject missing PDA signature");
        } catch (error) {
            rejected = true;
        }

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const moduleTokenState = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.isTrue(rejected);
        assert.equal(moduleTokenState.amount.toString(), depositAmount.toString());
        assert.equal(state.cachedNav.toString(), "0");
    });

    it("returns capital from the module to the vault and updates cached NAV", async () => {
        const setup = await setupMockModule();
        const depositAmount = 250_000;
        const returnAmount = 100_000;
        const vaultTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            setup.vault
        );

        await mintTokens(
            setup.underlyingMint,
            setup.moduleTokenAccount,
            depositAmount
        );

        await mockYieldModuleProgram.methods
            .returnCapital(new anchor.BN(returnAmount))
            .accountsPartial({
                vaultAuthority: setup.vault,
                mockModuleState: setup.mockModuleState,
                mockModuleAuthority: setup.mockModuleAuthority,
                underlyingMint: setup.underlyingMint,
                moduleTokenAccount: setup.moduleTokenAccount,
                vaultTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const state = await mockYieldModuleProgram.account.mockModuleState.fetch(
            setup.mockModuleState
        );
        const vaultTokenState = await fetchTokenAccount(vaultTokenAccount);
        const moduleTokenState = await fetchTokenAccount(
            setup.moduleTokenAccount
        );
        const expectedRemainingNav = depositAmount - returnAmount;

        assert.equal(vaultTokenState.amount.toString(), returnAmount.toString());
        assert.equal(
            moduleTokenState.amount.toString(),
            expectedRemainingNav.toString()
        );
        assert.equal(state.cachedNav.toString(), expectedRemainingNav.toString());
        assert.isTrue(state.lastUpdatedSlot.gt(new anchor.BN(0)));
    });

    it("rejects return_capital with zero amount", async () => {
        const setup = await setupMockModule();
        const vaultTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            setup.vault
        );

        try {
            await mockYieldModuleProgram.methods
                .returnCapital(new anchor.BN(0))
                .accountsPartial({
                    vaultAuthority: setup.vault,
                    mockModuleState: setup.mockModuleState,
                    mockModuleAuthority: setup.mockModuleAuthority,
                    underlyingMint: setup.underlyingMint,
                    moduleTokenAccount: setup.moduleTokenAccount,
                    vaultTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            assert.fail("Expected return_capital to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }
    });

    it("rejects return_capital above module liquidity", async () => {
        const setup = await setupMockModule();
        const vaultTokenAccount = await createTokenAccount(
            setup.underlyingMint,
            setup.vault
        );

        try {
            await mockYieldModuleProgram.methods
                .returnCapital(new anchor.BN(1))
                .accountsPartial({
                    vaultAuthority: setup.vault,
                    mockModuleState: setup.mockModuleState,
                    mockModuleAuthority: setup.mockModuleAuthority,
                    underlyingMint: setup.underlyingMint,
                    moduleTokenAccount: setup.moduleTokenAccount,
                    vaultTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            assert.fail("Expected return_capital to reject insufficient liquidity");
        } catch (error) {
            assert.include(String(error), "InsufficientLiquidity");
        }

        const vaultTokenState = await fetchTokenAccount(vaultTokenAccount);
        const moduleTokenState = await fetchTokenAccount(
            setup.moduleTokenAccount
        );

        assert.equal(vaultTokenState.amount.toString(), "0");
        assert.equal(moduleTokenState.amount.toString(), "0");
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
