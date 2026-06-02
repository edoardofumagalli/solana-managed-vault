import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { MockYieldModule } from "../../target/types/mock_yield_module";
import { manager, program } from "./setup";
import {
    deriveMockModuleAuthorityPda,
    deriveMockModuleStatePda,
    deriveModuleEntryPda,
} from "./pda";
import { VaultSetup } from "./vault";

export const mockYieldModuleProgram = anchor.workspace
    .mockYieldModule as Program<MockYieldModule>;

export type MockModuleSetup = {
    mockModuleState: PublicKey;
    mockModuleAuthority: PublicKey;
    moduleTokenAccount: PublicKey;
};

export type RegisteredMockModuleSetup = VaultSetup & MockModuleSetup & {
    moduleEntry: PublicKey;
    policySeed: anchor.BN;
};

export async function setupMockModule(
    setup: Pick<VaultSetup, "vault" | "underlyingMint">
): Promise<MockModuleSetup> {
    const [mockModuleState] = deriveMockModuleStatePda(
        setup.vault,
        mockYieldModuleProgram.programId
    );
    const [mockModuleAuthority] = deriveMockModuleAuthorityPda(
        mockModuleState,
        mockYieldModuleProgram.programId
    );
    const moduleTokenAccount = getAssociatedTokenAddressSync(
        setup.underlyingMint,
        mockModuleAuthority,
        true,
        TOKEN_PROGRAM_ID
    );

    await mockYieldModuleProgram.methods
        .initialize(program.programId)
        .accountsPartial({
            payer: manager,
            vault: setup.vault,
            underlyingMint: setup.underlyingMint,
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

export async function registerMockModule(
    setup: VaultSetup & MockModuleSetup,
    policySeed: anchor.BN = new anchor.BN(0)
): Promise<RegisteredMockModuleSetup> {
    const [moduleEntry] = deriveModuleEntryPda(
        setup.vault,
        mockYieldModuleProgram.programId,
        policySeed
    );

    await program.methods
        .registerModule(policySeed)
        .accountsPartial({
            manager,
            vault: setup.vault,
            moduleEntry,
            moduleState: setup.mockModuleState,
            moduleUnderlyingTokenAccount: setup.moduleTokenAccount,
            moduleProgram: mockYieldModuleProgram.programId,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    return {
        ...setup,
        moduleEntry,
        policySeed,
    };
}

export async function setupRegisteredMockModule(
    setup: VaultSetup,
    policySeed: anchor.BN = new anchor.BN(0)
): Promise<RegisteredMockModuleSetup> {
    const mockModule = await setupMockModule(setup);

    return registerMockModule(
        {
            ...setup,
            ...mockModule,
        },
        policySeed
    );
}
