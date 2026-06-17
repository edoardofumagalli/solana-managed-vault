import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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
    getAccount,
} from "@solana/spl-token";

import { AnchorManagedVault } from "../../../target/types/anchor_managed_vault";
import { KaminoYieldModule } from "../../../target/types/kamino_yield_module";
import { KAMINO_USDC, KLEND_PROGRAM_ID, MODULE_TYPE_TOKEN } from "./constants";
import { deriveKaminoUsdcAccounts } from "./pdas";
import {
    kaminoDeployRemainingAccounts,
    kaminoRecallRemainingAccounts,
} from "./remaining_accounts";
import {
    KaminoUsdcDerivedAccounts,
    KaminoUsdcModuleFixtureJson,
    KaminoUsdcSetupTransactionsJson,
} from "./types";

export function buildKaminoUsdcModuleFixture(params: {
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

export async function setupKaminoUsdcOnchain(params: {
    program: Program<AnchorManagedVault>;
    kaminoYieldModuleProgram: Program<KaminoYieldModule>;
    connection: Connection;
    payer: Keypair;
    manager: PublicKey;
    emergencyAdmin: PublicKey;
    maxFloatBps: number;
    managerWithdrawDelaySlots: string;
    policySeed: string;
}): Promise<KaminoUsdcSetupTransactionsJson> {
    console.log("\nValidating Surfpool/Kamino USDC accounts...");
    await assertKaminoUsdcAccountsAvailable(params.connection);

    const accounts = deriveKaminoUsdcAccounts({
        vaultProgramId: params.program.programId,
        kaminoYieldModuleProgramId: params.kaminoYieldModuleProgram.programId,
        policySeed: params.policySeed,
    });

    const initializeVault = await ensureKaminoUsdcVault({
        program: params.program,
        connection: params.connection,
        manager: params.manager,
        emergencyAdmin: params.emergencyAdmin,
        maxFloatBps: params.maxFloatBps,
        managerWithdrawDelaySlots: params.managerWithdrawDelaySlots,
        accounts,
    });
    const initializeKaminoModule = await ensureKaminoUsdcModule({
        program: params.program,
        kaminoYieldModuleProgram: params.kaminoYieldModuleProgram,
        connection: params.connection,
        manager: params.manager,
        accounts,
    });

    console.log("Creating Kamino module token accounts idempotently...");
    const moduleUnderlyingTokenAccount =
        await createAssociatedTokenAccountIdempotent(
            params.connection,
            params.payer,
            KAMINO_USDC.liquidityMint,
            accounts.moduleState,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined,
            true
        );
    assertPublicKeyEquals(
        moduleUnderlyingTokenAccount,
        accounts.moduleUnderlyingTokenAccount,
        "Kamino module underlying token account"
    );

    const vaultCollateralAccount = await createAssociatedTokenAccountIdempotent(
        params.connection,
        params.payer,
        KAMINO_USDC.collateralMint,
        accounts.moduleState,
        undefined,
        TOKEN_PROGRAM_ID,
        undefined,
        true
    );
    assertPublicKeyEquals(
        vaultCollateralAccount,
        accounts.vaultCollateralAccount,
        "Kamino vault collateral token account"
    );

    return {
        ...(initializeVault ? { initializeVault } : {}),
        ...(initializeKaminoModule ? { initializeKaminoModule } : {}),
    };
}
