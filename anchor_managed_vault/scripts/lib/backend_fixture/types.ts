import { PublicKey } from "@solana/web3.js";

export type SetupArgs = {
    execute: boolean;
    includeMockModule: boolean;
    includeKaminoUsdcModule: boolean;
    setupKaminoUsdcOnchain: boolean;
    output: string;
    rpcUrl: string;
    walletPath: string;
    decimals: number;
    maxFloatBps: number;
    managerWithdrawDelaySlots: string;
    mintAmount: string;
    depositAmount: string;
    sharesToWithdraw: string;
    mockModulePolicySeed: string;
    kaminoModulePolicySeed: string;
    moduleAmount: string;
    kaminoModuleRecallAmount: string;
    user?: PublicKey;
    emergencyAdmin?: PublicKey;
};

export type RemainingAccountJson = {
    pubkey: string;
    isWritable: boolean;
    isSigner: boolean;
    role: string;
};

export type MockYieldModuleFixtureJson = {
    programId: string;
    policySeed: string;
    accounts: {
        moduleEntry: string;
        moduleProgram: string;
        moduleState: string;
        mockModuleAuthority: string;
        moduleUnderlyingTokenAccount: string;
    };
    remainingAccounts: {
        deploy: RemainingAccountJson[];
        recall: RemainingAccountJson[];
    };
    requests: {
        register: {
            vault: string;
            manager: string;
            moduleProgram: string;
            moduleState: string;
            moduleUnderlyingTokenAccount: string;
            policySeed: string;
            simulate: boolean;
        };
        syncNav: {
            vault: string;
            moduleEntry: string;
            feePayer: string;
            simulate: boolean;
        };
        deploy: {
            vault: string;
            manager: string;
            moduleEntry: string;
            amount: string;
            remainingAccounts: RemainingAccountJson[];
            simulate: boolean;
        };
        recall: {
            vault: string;
            manager: string;
            moduleEntry: string;
            amount: string;
            remainingAccounts: RemainingAccountJson[];
            simulate: boolean;
        };
    };
    transactions: {
        initializeMockModule: string;
    };
};

export type KaminoUsdcSetupTransactionsJson = {
    initializeVault?: string;
    initializeKaminoModule?: string;
};

export type KaminoUsdcModuleFixtureJson = {
    programId: string;
    policySeed: string;
    source: "static-surfpool-usdc";
    mode: "token";
    setup: {
        requiresSurfpoolClones: boolean;
        initializesVault: boolean;
        initializesKaminoModule: boolean;
        registersModule: boolean;
    };
    reserveAccounts: {
        klendProgram: string;
        lendingMarket: string;
        reserve: string;
        liquidityMint: string;
        liquiditySupplyVault: string;
        collateralMint: string;
        scopePrices: string;
        lendingMarketAuthority: string;
    };
    oracleAccounts: {
        pythOracle: string;
        switchboardPriceOracle: string;
        switchboardTwapOracle: string;
        scopePrices: string;
    };
    accounts: {
        vault: string;
        shareMint: string;
        vaultTokenAccount: string;
        moduleCallAuthority: string;
        moduleEntry: string;
        moduleProgram: string;
        moduleConfig: string;
        moduleState: string;
        moduleUnderlyingTokenAccount: string;
        vaultCollateralAccount: string;
    };
    remainingAccounts: {
        deploy: RemainingAccountJson[];
        recall: RemainingAccountJson[];
    };
    transactions?: KaminoUsdcSetupTransactionsJson;
    requests: {
        register: {
            vault: string;
            manager: string;
            moduleProgram: string;
            moduleState: string;
            moduleUnderlyingTokenAccount: string;
            policySeed: string;
            simulate: boolean;
        };
        syncNav: {
            vault: string;
            moduleEntry: string;
            feePayer: string;
            simulate: boolean;
        };
        deploy: {
            vault: string;
            manager: string;
            moduleEntry: string;
            amount: string;
            remainingAccounts: RemainingAccountJson[];
            simulate: boolean;
        };
        recall: {
            vault: string;
            manager: string;
            moduleEntry: string;
            amount: string;
            remainingAccounts: RemainingAccountJson[];
            simulate: boolean;
        };
    };
};

export type FixtureJson = {
    schema: string;
    createdAt: string;
    rpcUrl: string;
    programId: string;
    manager: string;
    user: string;
    config: {
        decimals: number;
        maxFloatBps: number;
        managerWithdrawDelaySlots: string;
    };
    amounts: {
        mintedUnderlying: string;
        suggestedDeposit: string;
        suggestedSharesToWithdraw: string;
        suggestedModuleAmount: string;
        suggestedKaminoModuleRecallAmount: string;
    };
    accounts: {
        underlyingMint: string;
        vault: string;
        shareMint: string;
        vaultTokenAccount: string;
        userUnderlyingTokenAccount: string;
        userShareTokenAccount: string;
        userPosition: string;
    };
    transactions: {
        initializeVault: string;
        mintUnderlying: string;
    };
    modules?: {
        mockYield?: MockYieldModuleFixtureJson;
        kaminoUsdc?: KaminoUsdcModuleFixtureJson;
    };
};

export type KaminoUsdcDerivedAccounts = {
    vault: PublicKey;
    shareMint: PublicKey;
    vaultTokenAccount: PublicKey;
    moduleCallAuthority: PublicKey;
    moduleEntry: PublicKey;
    moduleConfig: PublicKey;
    moduleState: PublicKey;
    moduleUnderlyingTokenAccount: PublicKey;
    vaultCollateralAccount: PublicKey;
};
