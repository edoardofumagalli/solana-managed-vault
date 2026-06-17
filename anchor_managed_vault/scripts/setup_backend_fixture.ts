import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountIdempotent,
    createMint,
    getAccount,
    getAssociatedTokenAddressSync,
    getMint,
    mintTo,
} from "@solana/spl-token";

import { AnchorManagedVault } from "../target/types/anchor_managed_vault";
import { KaminoYieldModule } from "../target/types/kamino_yield_module";
import { MockYieldModule } from "../target/types/mock_yield_module";
import {
    parseArgs,
    parseSafeTokenAmount,
    printUsage,
} from "./lib/backend_fixture/cli";
import { FIXTURE_SCHEMA } from "./lib/backend_fixture/constants";
import { createProvider, writeJson } from "./lib/backend_fixture/io";
import {
    buildKaminoUsdcModuleFixture,
    setupKaminoUsdcOnchain,
} from "./lib/backend_fixture/kamino_usdc";
import { initializeMockYieldModuleFixture } from "./lib/backend_fixture/mock_yield";
import {
    deriveShareMintPda,
    deriveUserVaultPositionPda,
    deriveVaultPda,
} from "./lib/backend_fixture/pdas";
import {
    FixtureJson,
    KaminoUsdcModuleFixtureJson,
    KaminoUsdcSetupTransactionsJson,
    MockYieldModuleFixtureJson,
    SetupArgs,
} from "./lib/backend_fixture/types";

function printPlan(
    args: SetupArgs,
    provider: AnchorProvider,
    program: Program<AnchorManagedVault>,
    manager: PublicKey
): void {
    console.log("Backend fixture setup plan");
    console.log(`rpc url: ${args.rpcUrl}`);
    console.log(`program id: ${program.programId.toBase58()}`);
    console.log(`manager: ${manager.toBase58()}`);
    console.log(`user: ${(args.user ?? manager).toBase58()}`);
    console.log(
        `emergency admin: ${(args.emergencyAdmin ?? manager).toBase58()}`
    );
    console.log(`decimals: ${args.decimals}`);
    console.log(`max float bps: ${args.maxFloatBps}`);
    console.log(
        `manager withdraw delay slots: ${args.managerWithdrawDelaySlots}`
    );
    console.log(`mint amount: ${args.mintAmount}`);
    console.log(`suggested deposit amount: ${args.depositAmount}`);
    console.log(`suggested shares to withdraw: ${args.sharesToWithdraw}`);
    console.log(`suggested module amount: ${args.moduleAmount}`);
    console.log(
        `suggested Kamino module recall amount: ${args.kaminoModuleRecallAmount}`
    );
    console.log(`include mock module: ${args.includeMockModule}`);
    console.log(`mock module policy seed: ${args.mockModulePolicySeed}`);
    console.log(`include Kamino USDC module: ${args.includeKaminoUsdcModule}`);
    console.log(`setup Kamino USDC on-chain: ${args.setupKaminoUsdcOnchain}`);
    console.log(`Kamino module policy seed: ${args.kaminoModulePolicySeed}`);
    console.log(`wallet path: ${args.walletPath}`);
    console.log(`output: ${args.output}`);

    if (!args.execute) {
        console.log(
            "\nDry run only. Add --execute to create the fixture on-chain."
        );
    }
}

async function main(): Promise<void> {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        printUsage();
        return;
    }

    const args = parseArgs(process.argv.slice(2));

    const { provider, payer } = createProvider(args);
    anchor.setProvider(provider);
    const wallet = provider.wallet;
    const program = anchor.workspace
        .anchorManagedVault as Program<AnchorManagedVault>;
    const mockYieldModuleProgram = anchor.workspace
        .mockYieldModule as Program<MockYieldModule>;
    const kaminoYieldModuleProgram = anchor.workspace
        .kaminoYieldModule as Program<KaminoYieldModule>;
    const connection = provider.connection;
    const manager = wallet.publicKey;
    const user = args.user ?? manager;
    const emergencyAdmin = args.emergencyAdmin ?? manager;

    printPlan(args, provider, program, manager);

    if (!args.execute) {
        return;
    }

    const programAccount = await connection.getAccountInfo(program.programId);
    if (!programAccount) {
        throw new Error(
            "Program account not found on the selected cluster. Deploy the program before running fixture setup."
        );
    }

    if (args.includeMockModule) {
        const mockProgramAccount = await connection.getAccountInfo(
            mockYieldModuleProgram.programId
        );
        if (!mockProgramAccount) {
            throw new Error(
                "Mock yield module program account not found on the selected cluster. Deploy the mock_yield_module program or rerun without --include-mock-module."
            );
        }
    }

    if (args.includeKaminoUsdcModule) {
        const kaminoProgramAccount = await connection.getAccountInfo(
            kaminoYieldModuleProgram.programId
        );
        if (!kaminoProgramAccount) {
            throw new Error(
                "Kamino yield module program account not found on the selected cluster. Deploy the kamino_yield_module program or rerun without --include-kamino-usdc-module."
            );
        }
    }

    let kaminoUsdcSetupTransactions:
        | KaminoUsdcSetupTransactionsJson
        | undefined;
    if (args.setupKaminoUsdcOnchain) {
        kaminoUsdcSetupTransactions = await setupKaminoUsdcOnchain({
            program,
            kaminoYieldModuleProgram,
            connection,
            payer,
            manager,
            emergencyAdmin,
            maxFloatBps: args.maxFloatBps,
            managerWithdrawDelaySlots: args.managerWithdrawDelaySlots,
            policySeed: args.kaminoModulePolicySeed,
        });
    }

    console.log("\nCreating underlying mint...");
    const underlyingMint = await createMint(
        connection,
        payer,
        manager,
        null,
        args.decimals,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
    );

    const [vault] = deriveVaultPda(program.programId, underlyingMint);
    const [shareMint] = deriveShareMintPda(program.programId, vault);
    const [userPosition] = deriveUserVaultPositionPda(
        program.programId,
        vault,
        user
    );
    const vaultTokenAccount = getAssociatedTokenAddressSync(
        underlyingMint,
        vault,
        true,
        TOKEN_PROGRAM_ID
    );

    console.log("Initializing vault...");
    const initializeVault = await program.methods
        .initializeVault(
            args.maxFloatBps,
            emergencyAdmin,
            new anchor.BN(args.managerWithdrawDelaySlots)
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

    console.log("Creating user token accounts...");
    const userUnderlyingTokenAccount =
        await createAssociatedTokenAccountIdempotent(
            connection,
            payer,
            underlyingMint,
            user,
            undefined,
            TOKEN_PROGRAM_ID
        );

    const userShareTokenAccount = await createAssociatedTokenAccountIdempotent(
        connection,
        payer,
        shareMint,
        user,
        undefined,
        TOKEN_PROGRAM_ID
    );

    console.log("Minting test underlying to user...");
    const mintUnderlying = await mintTo(
        connection,
        payer,
        underlyingMint,
        userUnderlyingTokenAccount,
        payer,
        parseSafeTokenAmount("mint-amount", args.mintAmount),
        [],
        undefined,
        TOKEN_PROGRAM_ID
    );

    let mockYieldModuleFixture: MockYieldModuleFixtureJson | undefined;
    if (args.includeMockModule) {
        mockYieldModuleFixture = await initializeMockYieldModuleFixture({
            program,
            mockYieldModuleProgram,
            manager,
            vault,
            underlyingMint,
            vaultTokenAccount,
            moduleAmount: args.moduleAmount,
            policySeed: args.mockModulePolicySeed,
        });
    }

    let kaminoUsdcModuleFixture: KaminoUsdcModuleFixtureJson | undefined;
    if (args.includeKaminoUsdcModule) {
        kaminoUsdcModuleFixture = buildKaminoUsdcModuleFixture({
            vaultProgramId: program.programId,
            kaminoYieldModuleProgramId: kaminoYieldModuleProgram.programId,
            manager,
            moduleAmount: args.moduleAmount,
            recallAmount: args.kaminoModuleRecallAmount,
            policySeed: args.kaminoModulePolicySeed,
            setup: args.setupKaminoUsdcOnchain
                ? {
                      initializesVault: true,
                      initializesKaminoModule: true,
                      registersModule: false,
                  }
                : undefined,
            transactions: kaminoUsdcSetupTransactions,
        });
    }

    const modules =
        mockYieldModuleFixture || kaminoUsdcModuleFixture
            ? {
                  ...(mockYieldModuleFixture
                      ? { mockYield: mockYieldModuleFixture }
                      : {}),
                  ...(kaminoUsdcModuleFixture
                      ? { kaminoUsdc: kaminoUsdcModuleFixture }
                      : {}),
              }
            : undefined;

    const vaultState = await program.account.vault.fetch(vault);
    const underlyingMintAccount = await getMint(
        connection,
        underlyingMint,
        undefined,
        TOKEN_PROGRAM_ID
    );
    const shareMintAccount = await getMint(
        connection,
        shareMint,
        undefined,
        TOKEN_PROGRAM_ID
    );
    const userUnderlying = await getAccount(
        connection,
        userUnderlyingTokenAccount,
        undefined,
        TOKEN_PROGRAM_ID
    );

    const fixture: FixtureJson = {
        schema: FIXTURE_SCHEMA,
        createdAt: new Date().toISOString(),
        rpcUrl: connection.rpcEndpoint,
        programId: program.programId.toBase58(),
        manager: manager.toBase58(),
        user: user.toBase58(),
        config: {
            decimals: args.decimals,
            maxFloatBps: vaultState.maxFloatBps,
            managerWithdrawDelaySlots:
                vaultState.managerWithdrawDelaySlots.toString(),
        },
        amounts: {
            mintedUnderlying: userUnderlying.amount.toString(),
            suggestedDeposit: args.depositAmount,
            suggestedSharesToWithdraw: args.sharesToWithdraw,
            suggestedModuleAmount: args.moduleAmount,
            suggestedKaminoModuleRecallAmount: args.kaminoModuleRecallAmount,
        },
        accounts: {
            underlyingMint: underlyingMint.toBase58(),
            vault: vault.toBase58(),
            shareMint: shareMint.toBase58(),
            vaultTokenAccount: vaultTokenAccount.toBase58(),
            userUnderlyingTokenAccount: userUnderlyingTokenAccount.toBase58(),
            userShareTokenAccount: userShareTokenAccount.toBase58(),
            userPosition: userPosition.toBase58(),
        },
        transactions: {
            initializeVault,
            mintUnderlying,
        },
        modules,
    };

    console.log("\nFixture summary");
    console.log(`underlying mint: ${fixture.accounts.underlyingMint}`);
    console.log(`vault: ${fixture.accounts.vault}`);
    console.log(`share mint: ${fixture.accounts.shareMint}`);
    console.log(`vault token account: ${fixture.accounts.vaultTokenAccount}`);
    console.log(
        `user underlying token account: ${fixture.accounts.userUnderlyingTokenAccount}`
    );
    console.log(
        `user share token account: ${fixture.accounts.userShareTokenAccount}`
    );
    console.log(`user underlying balance: ${fixture.amounts.mintedUnderlying}`);
    console.log(`underlying decimals: ${underlyingMintAccount.decimals}`);
    console.log(`share decimals: ${shareMintAccount.decimals}`);
    if (fixture.modules?.mockYield) {
        console.log("mock module fixture:");
        console.log(`  program id: ${fixture.modules.mockYield.programId}`);
        console.log(
            `  module entry: ${fixture.modules.mockYield.accounts.moduleEntry}`
        );
        console.log(
            `  module state: ${fixture.modules.mockYield.accounts.moduleState}`
        );
        console.log(
            `  module token account: ${fixture.modules.mockYield.accounts.moduleUnderlyingTokenAccount}`
        );
    }
    if (fixture.modules?.kaminoUsdc) {
        console.log("Kamino USDC module fixture:");
        console.log(`  program id: ${fixture.modules.kaminoUsdc.programId}`);
        console.log(
            `  USDC mint: ${fixture.modules.kaminoUsdc.reserveAccounts.liquidityMint}`
        );
        console.log(
            `  Kamino vault: ${fixture.modules.kaminoUsdc.accounts.vault}`
        );
        console.log(
            `  module entry: ${fixture.modules.kaminoUsdc.accounts.moduleEntry}`
        );
        console.log(
            `  module state: ${fixture.modules.kaminoUsdc.accounts.moduleState}`
        );
        console.log(
            `  deploy remaining accounts: ${fixture.modules.kaminoUsdc.remainingAccounts.deploy.length}`
        );
        console.log(
            `  recall remaining accounts: ${fixture.modules.kaminoUsdc.remainingAccounts.recall.length}`
        );
        if (fixture.modules.kaminoUsdc.setup.initializesVault) {
            console.log("  setup: Kamino USDC vault/module prepared on-chain");
            if (fixture.modules.kaminoUsdc.transactions?.initializeVault) {
                console.log(
                    `  initialize vault tx: ${fixture.modules.kaminoUsdc.transactions.initializeVault}`
                );
            }
            if (
                fixture.modules.kaminoUsdc.transactions?.initializeKaminoModule
            ) {
                console.log(
                    `  initialize module tx: ${fixture.modules.kaminoUsdc.transactions.initializeKaminoModule}`
                );
            }
            console.log(
                "  note: module registration is still performed through the backend modules/register endpoint."
            );
        } else {
            console.log(
                "  note: this section is static Surfpool/Kamino account routing; it does not initialize the Kamino USDC vault or module."
            );
        }
    }

    writeJson(args.output, fixture);
}

main().catch((error) => {
    console.error("Backend fixture setup failed:");
    console.error(error.message);
    if ((error as Error & { showUsage?: boolean }).showUsage) {
        printUsage();
    }
    process.exitCode = 1;
});
