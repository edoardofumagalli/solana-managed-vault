import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
    AccountInfo,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
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
import {
    FIXTURE_SCHEMA,
    KAMINO_USDC,
    KLEND_PROGRAM_ID,
    MODULE_TYPE_TOKEN,
} from "./lib/backend_fixture/constants";
import { createProvider, writeJson } from "./lib/backend_fixture/io";
import { initializeMockYieldModuleFixture } from "./lib/backend_fixture/mock_yield";
import {
    deriveKaminoUsdcAccounts,
    deriveShareMintPda,
    deriveUserVaultPositionPda,
    deriveVaultPda,
} from "./lib/backend_fixture/pdas";
import {
    kaminoDeployRemainingAccounts,
    kaminoRecallRemainingAccounts,
} from "./lib/backend_fixture/remaining_accounts";
import {
    FixtureJson,
    KaminoUsdcDerivedAccounts,
    KaminoUsdcModuleFixtureJson,
    KaminoUsdcSetupTransactionsJson,
    MockYieldModuleFixtureJson,
    SetupArgs,
} from "./lib/backend_fixture/types";

function buildKaminoUsdcModuleFixture(params: {
    vaultProgramId: PublicKey;
    kaminoYieldModuleProgramId: PublicKey;
    manager: PublicKey;
    moduleAmount: string;
    recallAmount: string;
    policySeed: string;
    setup?: Partial<KaminoUsdcModuleFixtureJson["setup"]>;
    transactions?: KaminoUsdcSetupTransactionsJson;
}): KaminoUsdcModuleFixtureJson {
    const accounts = deriveKaminoUsdcAccounts(params);
    const deployRemainingAccounts = kaminoDeployRemainingAccounts({
        moduleConfig: accounts.moduleConfig,
        moduleState: accounts.moduleState,
        moduleUnderlyingTokenAccount: accounts.moduleUnderlyingTokenAccount,
        vaultCollateralAccount: accounts.vaultCollateralAccount,
    });
    const recallRemainingAccounts = kaminoRecallRemainingAccounts({
        moduleConfig: accounts.moduleConfig,
        moduleState: accounts.moduleState,
        moduleUnderlyingTokenAccount: accounts.moduleUnderlyingTokenAccount,
        vaultCollateralAccount: accounts.vaultCollateralAccount,
        vaultTokenAccount: accounts.vaultTokenAccount,
    });

    return {
        programId: params.kaminoYieldModuleProgramId.toBase58(),
        policySeed: params.policySeed,
        source: "static-surfpool-usdc",
        mode: "token",
        setup: {
            requiresSurfpoolClones: true,
            initializesVault: params.setup?.initializesVault ?? false,
            initializesKaminoModule:
                params.setup?.initializesKaminoModule ?? false,
            registersModule: params.setup?.registersModule ?? false,
        },
        reserveAccounts: {
            klendProgram: KLEND_PROGRAM_ID.toBase58(),
            lendingMarket: KAMINO_USDC.lendingMarket.toBase58(),
            reserve: KAMINO_USDC.reserve.toBase58(),
            liquidityMint: KAMINO_USDC.liquidityMint.toBase58(),
            liquiditySupplyVault: KAMINO_USDC.liquiditySupplyVault.toBase58(),
            collateralMint: KAMINO_USDC.collateralMint.toBase58(),
            scopePrices: KAMINO_USDC.scopePrices.toBase58(),
            lendingMarketAuthority:
                KAMINO_USDC.lendingMarketAuthority.toBase58(),
        },
        oracleAccounts: {
            pythOracle: KLEND_PROGRAM_ID.toBase58(),
            switchboardPriceOracle: KLEND_PROGRAM_ID.toBase58(),
            switchboardTwapOracle: KLEND_PROGRAM_ID.toBase58(),
            scopePrices: KAMINO_USDC.scopePrices.toBase58(),
        },
        accounts: {
            vault: accounts.vault.toBase58(),
            shareMint: accounts.shareMint.toBase58(),
            vaultTokenAccount: accounts.vaultTokenAccount.toBase58(),
            moduleCallAuthority: accounts.moduleCallAuthority.toBase58(),
            moduleEntry: accounts.moduleEntry.toBase58(),
            moduleProgram: params.kaminoYieldModuleProgramId.toBase58(),
            moduleConfig: accounts.moduleConfig.toBase58(),
            moduleState: accounts.moduleState.toBase58(),
            moduleUnderlyingTokenAccount:
                accounts.moduleUnderlyingTokenAccount.toBase58(),
            vaultCollateralAccount: accounts.vaultCollateralAccount.toBase58(),
        },
        remainingAccounts: {
            deploy: deployRemainingAccounts,
            recall: recallRemainingAccounts,
        },
        ...(params.transactions ? { transactions: params.transactions } : {}),
        requests: {
            register: {
                vault: accounts.vault.toBase58(),
                manager: params.manager.toBase58(),
                moduleProgram: params.kaminoYieldModuleProgramId.toBase58(),
                moduleState: accounts.moduleState.toBase58(),
                moduleUnderlyingTokenAccount:
                    accounts.moduleUnderlyingTokenAccount.toBase58(),
                policySeed: params.policySeed,
                simulate: true,
            },
            syncNav: {
                vault: accounts.vault.toBase58(),
                moduleEntry: accounts.moduleEntry.toBase58(),
                feePayer: params.manager.toBase58(),
                simulate: true,
            },
            deploy: {
                vault: accounts.vault.toBase58(),
                manager: params.manager.toBase58(),
                moduleEntry: accounts.moduleEntry.toBase58(),
                amount: params.moduleAmount,
                remainingAccounts: deployRemainingAccounts,
                simulate: true,
            },
            recall: {
                vault: accounts.vault.toBase58(),
                manager: params.manager.toBase58(),
                moduleEntry: accounts.moduleEntry.toBase58(),
                amount: params.recallAmount,
                remainingAccounts: recallRemainingAccounts,
                simulate: true,
            },
        },
    };
}

function assertPublicKeyEquals(
    actual: PublicKey,
    expected: PublicKey,
    label: string
): void {
    if (!actual.equals(expected)) {
        throw new Error(
            `${label} mismatch: expected ${expected.toBase58()}, got ${actual.toBase58()}`
        );
    }
}

async function fetchAccountInfoOrFail(
    connection: Connection,
    pubkey: PublicKey,
    label: string
): Promise<AccountInfo<Buffer>> {
    const account = await connection.getAccountInfo(pubkey);

    if (!account) {
        throw new Error(`${label} account not found: ${pubkey.toBase58()}`);
    }

    return account;
}

async function assertKaminoUsdcAccountsAvailable(
    connection: Connection
): Promise<void> {
    const klendProgram = await fetchAccountInfoOrFail(
        connection,
        KLEND_PROGRAM_ID,
        "Klend program"
    );
    if (!klendProgram.executable) {
        throw new Error("Klend program account must be executable");
    }

    const lendingMarket = await fetchAccountInfoOrFail(
        connection,
        KAMINO_USDC.lendingMarket,
        "Kamino lending market"
    );
    assertPublicKeyEquals(
        lendingMarket.owner,
        KLEND_PROGRAM_ID,
        "Kamino lending market owner"
    );

    const reserve = await fetchAccountInfoOrFail(
        connection,
        KAMINO_USDC.reserve,
        "Kamino USDC reserve"
    );
    assertPublicKeyEquals(
        reserve.owner,
        KLEND_PROGRAM_ID,
        "Kamino reserve owner"
    );

    const liquidityMint = await fetchAccountInfoOrFail(
        connection,
        KAMINO_USDC.liquidityMint,
        "USDC mint"
    );
    assertPublicKeyEquals(
        liquidityMint.owner,
        TOKEN_PROGRAM_ID,
        "USDC mint owner"
    );

    const collateralMint = await fetchAccountInfoOrFail(
        connection,
        KAMINO_USDC.collateralMint,
        "Kamino collateral mint"
    );
    assertPublicKeyEquals(
        collateralMint.owner,
        TOKEN_PROGRAM_ID,
        "Kamino collateral mint owner"
    );

    const liquiditySupply = await getAccount(
        connection,
        KAMINO_USDC.liquiditySupplyVault,
        undefined,
        TOKEN_PROGRAM_ID
    );
    assertPublicKeyEquals(
        liquiditySupply.mint,
        KAMINO_USDC.liquidityMint,
        "Kamino liquidity supply vault mint"
    );
    assertPublicKeyEquals(
        liquiditySupply.owner,
        KAMINO_USDC.lendingMarketAuthority,
        "Kamino liquidity supply vault owner"
    );

    const scopePrices = await fetchAccountInfoOrFail(
        connection,
        KAMINO_USDC.scopePrices,
        "Scope prices oracle"
    );
    if (scopePrices.data.length === 0) {
        throw new Error("Scope prices oracle account must contain data");
    }
}

async function ensureKaminoUsdcVault(params: {
    program: Program<AnchorManagedVault>;
    connection: Connection;
    manager: PublicKey;
    emergencyAdmin: PublicKey;
    maxFloatBps: number;
    managerWithdrawDelaySlots: string;
    accounts: KaminoUsdcDerivedAccounts;
}): Promise<string | undefined> {
    const existingVault = await params.connection.getAccountInfo(
        params.accounts.vault
    );
    let initializeVault: string | undefined;

    if (!existingVault) {
        console.log("Initializing Kamino USDC vault...");
        initializeVault = await params.program.methods
            .initializeVault(
                params.maxFloatBps,
                params.emergencyAdmin,
                new anchor.BN(params.managerWithdrawDelaySlots)
            )
            .accountsPartial({
                manager: params.manager,
                underlyingMint: KAMINO_USDC.liquidityMint,
                vault: params.accounts.vault,
                shareMint: params.accounts.shareMint,
                vaultTokenAccount: params.accounts.vaultTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .rpc();
    } else {
        console.log("Kamino USDC vault already exists, validating it...");
    }

    const vaultState = await params.program.account.vault.fetch(
        params.accounts.vault
    );
    assertPublicKeyEquals(
        vaultState.manager,
        params.manager,
        "Kamino USDC vault manager"
    );
    assertPublicKeyEquals(
        vaultState.underlyingMint,
        KAMINO_USDC.liquidityMint,
        "Kamino USDC vault underlying mint"
    );
    assertPublicKeyEquals(
        vaultState.shareMint,
        params.accounts.shareMint,
        "Kamino USDC vault share mint"
    );
    assertPublicKeyEquals(
        vaultState.vaultTokenAccount,
        params.accounts.vaultTokenAccount,
        "Kamino USDC vault token account"
    );

    return initializeVault;
}

async function ensureKaminoUsdcModule(params: {
    program: Program<AnchorManagedVault>;
    kaminoYieldModuleProgram: Program<KaminoYieldModule>;
    connection: Connection;
    manager: PublicKey;
    accounts: KaminoUsdcDerivedAccounts;
}): Promise<string | undefined> {
    const existingState = await params.connection.getAccountInfo(
        params.accounts.moduleState
    );
    let initializeKaminoModule: string | undefined;

    if (!existingState) {
        console.log("Initializing Kamino USDC module state...");
        initializeKaminoModule = await params.kaminoYieldModuleProgram.methods
            .initialize({
                vaultProgramId: params.program.programId,
                lendingMarket: KAMINO_USDC.lendingMarket,
                kaminoReserve: KAMINO_USDC.reserve,
                moduleType: MODULE_TYPE_TOKEN,
                obligation: PublicKey.default,
            })
            .accountsPartial({
                payer: params.manager,
                vault: params.accounts.vault,
                moduleConfig: params.accounts.moduleConfig,
                kaminoModuleState: params.accounts.moduleState,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    } else {
        console.log(
            "Kamino USDC module state already exists, validating it..."
        );
    }

    const moduleConfigState =
        await params.kaminoYieldModuleProgram.account.moduleConfig.fetch(
            params.accounts.moduleConfig
        );
    const moduleState =
        await params.kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
            params.accounts.moduleState
        );

    assertPublicKeyEquals(
        moduleConfigState.vault,
        params.accounts.vault,
        "Kamino module config vault"
    );
    assertPublicKeyEquals(
        moduleConfigState.vaultProgramId,
        params.program.programId,
        "Kamino module config vault program id"
    );
    assertPublicKeyEquals(
        moduleConfigState.lendingMarket,
        KAMINO_USDC.lendingMarket,
        "Kamino module config lending market"
    );
    assertPublicKeyEquals(
        moduleConfigState.kaminoReserve,
        KAMINO_USDC.reserve,
        "Kamino module config reserve"
    );
    if (moduleConfigState.moduleType !== MODULE_TYPE_TOKEN) {
        throw new Error("Kamino module config must be token mode");
    }

    assertPublicKeyEquals(
        moduleState.vault,
        params.accounts.vault,
        "Kamino module state vault"
    );
    assertPublicKeyEquals(
        moduleState.vaultProgramId,
        params.program.programId,
        "Kamino module state vault program id"
    );
    assertPublicKeyEquals(
        moduleState.lendingMarket,
        KAMINO_USDC.lendingMarket,
        "Kamino module state lending market"
    );
    assertPublicKeyEquals(
        moduleState.kaminoReserve,
        KAMINO_USDC.reserve,
        "Kamino module state reserve"
    );
    if (moduleState.moduleType !== MODULE_TYPE_TOKEN) {
        throw new Error("Kamino module state must be token mode");
    }
    if (!moduleState.isInitialized) {
        throw new Error("Kamino module state must be initialized");
    }

    return initializeKaminoModule;
}

async function setupKaminoUsdcOnchain(params: {
    program: Program<AnchorManagedVault>;
    kaminoYieldModuleProgram: Program<KaminoYieldModule>;
    connection: Connection;
    payer: Keypair;
    manager: PublicKey;
    emergencyAdmin: PublicKey;
    maxFloatBps: number;
    managerWithdrawDelaySlots: string;
    accounts: KaminoUsdcDerivedAccounts;
}): Promise<KaminoUsdcSetupTransactionsJson> {
    console.log("\nValidating Surfpool/Kamino USDC accounts...");
    await assertKaminoUsdcAccountsAvailable(params.connection);

    const initializeVault = await ensureKaminoUsdcVault({
        program: params.program,
        connection: params.connection,
        manager: params.manager,
        emergencyAdmin: params.emergencyAdmin,
        maxFloatBps: params.maxFloatBps,
        managerWithdrawDelaySlots: params.managerWithdrawDelaySlots,
        accounts: params.accounts,
    });
    const initializeKaminoModule = await ensureKaminoUsdcModule({
        program: params.program,
        kaminoYieldModuleProgram: params.kaminoYieldModuleProgram,
        connection: params.connection,
        manager: params.manager,
        accounts: params.accounts,
    });

    console.log("Creating Kamino module token accounts idempotently...");
    const moduleUnderlyingTokenAccount =
        await createAssociatedTokenAccountIdempotent(
            params.connection,
            params.payer,
            KAMINO_USDC.liquidityMint,
            params.accounts.moduleState,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined,
            true
        );
    assertPublicKeyEquals(
        moduleUnderlyingTokenAccount,
        params.accounts.moduleUnderlyingTokenAccount,
        "Kamino module underlying token account"
    );

    const vaultCollateralAccount = await createAssociatedTokenAccountIdempotent(
        params.connection,
        params.payer,
        KAMINO_USDC.collateralMint,
        params.accounts.moduleState,
        undefined,
        TOKEN_PROGRAM_ID,
        undefined,
        true
    );
    assertPublicKeyEquals(
        vaultCollateralAccount,
        params.accounts.vaultCollateralAccount,
        "Kamino vault collateral token account"
    );

    return {
        ...(initializeVault ? { initializeVault } : {}),
        ...(initializeKaminoModule ? { initializeKaminoModule } : {}),
    };
}

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
        const kaminoUsdcAccounts = deriveKaminoUsdcAccounts({
            vaultProgramId: program.programId,
            kaminoYieldModuleProgramId: kaminoYieldModuleProgram.programId,
            policySeed: args.kaminoModulePolicySeed,
        });

        kaminoUsdcSetupTransactions = await setupKaminoUsdcOnchain({
            program,
            kaminoYieldModuleProgram,
            connection,
            payer,
            manager,
            emergencyAdmin,
            maxFloatBps: args.maxFloatBps,
            managerWithdrawDelaySlots: args.managerWithdrawDelaySlots,
            accounts: kaminoUsdcAccounts,
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
