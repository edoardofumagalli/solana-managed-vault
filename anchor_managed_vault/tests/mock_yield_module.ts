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
    underlyingMint: PublicKey;
    mockModuleState: PublicKey;
    mockModuleAuthority: PublicKey;
    mockModuleAuthorityBump: number;
    moduleTokenAccount: PublicKey;
};

async function setupMockModule(): Promise<MockModuleSetup> {
    const underlyingMint = await createUnderlyingMint();
    const vault = Keypair.generate().publicKey;

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
