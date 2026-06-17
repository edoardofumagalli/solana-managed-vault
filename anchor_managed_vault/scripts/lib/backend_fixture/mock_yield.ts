import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { AnchorManagedVault } from "../../../target/types/anchor_managed_vault";
import { MockYieldModule } from "../../../target/types/mock_yield_module";
import {
    deriveMockModuleAuthorityPda,
    deriveMockModuleStatePda,
    deriveModuleEntryPda,
} from "./pdas";
import {
    mockDeployRemainingAccounts,
    mockRecallRemainingAccounts,
} from "./remaining_accounts";
import { MockYieldModuleFixtureJson } from "./types";

export async function initializeMockYieldModuleFixture(params: {
    program: Program<AnchorManagedVault>;
    mockYieldModuleProgram: Program<MockYieldModule>;
    manager: PublicKey;
    vault: PublicKey;
    underlyingMint: PublicKey;
    vaultTokenAccount: PublicKey;
    moduleAmount: string;
    policySeed: string;
}): Promise<MockYieldModuleFixtureJson> {
    console.log("Initializing mock yield module...");

    const [mockModuleState] = deriveMockModuleStatePda(
        params.vault,
        params.mockYieldModuleProgram.programId
    );
    const [mockModuleAuthority] = deriveMockModuleAuthorityPda(
        mockModuleState,
        params.mockYieldModuleProgram.programId
    );
    const moduleTokenAccount = getAssociatedTokenAddressSync(
        params.underlyingMint,
        mockModuleAuthority,
        true,
        TOKEN_PROGRAM_ID
    );
    const [moduleEntry] = deriveModuleEntryPda(
        params.program.programId,
        params.vault,
        params.mockYieldModuleProgram.programId,
        params.policySeed
    );

    const initializeMockModule = await params.mockYieldModuleProgram.methods
        .initialize(params.program.programId)
        .accountsPartial({
            payer: params.manager,
            vault: params.vault,
            underlyingMint: params.underlyingMint,
            mockModuleState,
            mockModuleAuthority,
            moduleTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    const deployRemainingAccounts = mockDeployRemainingAccounts(
        mockModuleState,
        moduleTokenAccount
    );
    const recallRemainingAccounts = mockRecallRemainingAccounts({
        moduleState: mockModuleState,
        mockModuleAuthority,
        underlyingMint: params.underlyingMint,
        moduleTokenAccount,
        vaultTokenAccount: params.vaultTokenAccount,
    });

    return {
        programId: params.mockYieldModuleProgram.programId.toBase58(),
        policySeed: params.policySeed,
        accounts: {
            moduleEntry: moduleEntry.toBase58(),
            moduleProgram: params.mockYieldModuleProgram.programId.toBase58(),
            moduleState: mockModuleState.toBase58(),
            mockModuleAuthority: mockModuleAuthority.toBase58(),
            moduleUnderlyingTokenAccount: moduleTokenAccount.toBase58(),
        },
        remainingAccounts: {
            deploy: deployRemainingAccounts,
            recall: recallRemainingAccounts,
        },
        requests: {
            register: {
                vault: params.vault.toBase58(),
                manager: params.manager.toBase58(),
                moduleProgram:
                    params.mockYieldModuleProgram.programId.toBase58(),
                moduleState: mockModuleState.toBase58(),
                moduleUnderlyingTokenAccount: moduleTokenAccount.toBase58(),
                policySeed: params.policySeed,
                simulate: true,
            },
            syncNav: {
                vault: params.vault.toBase58(),
                moduleEntry: moduleEntry.toBase58(),
                feePayer: params.manager.toBase58(),
                simulate: true,
            },
            deploy: {
                vault: params.vault.toBase58(),
                manager: params.manager.toBase58(),
                moduleEntry: moduleEntry.toBase58(),
                amount: params.moduleAmount,
                remainingAccounts: deployRemainingAccounts,
                simulate: true,
            },
            recall: {
                vault: params.vault.toBase58(),
                manager: params.manager.toBase58(),
                moduleEntry: moduleEntry.toBase58(),
                amount: params.moduleAmount,
                remainingAccounts: recallRemainingAccounts,
                simulate: true,
            },
        },
        transactions: {
            initializeMockModule,
        },
    };
}
