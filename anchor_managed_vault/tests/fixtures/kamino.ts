import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Mainnet Kamino/Klend target used for Surfpool integration tests.
// Surfpool clones these accounts lazily from mainnet when the local RPC touches them.
export const KLEND_PROGRAM_ID = new PublicKey(
    "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);
export const KAMINO_MAIN_MARKET = new PublicKey(
    "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
);
export const KAMINO_SOL_RESERVE = new PublicKey(
    "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q"
);
export const KAMINO_SOL_UNDERLYING_MINT = NATIVE_MINT;

// klend-interface uses KLEND_PROGRAM_ID as the AccountMeta placeholder when an
// optional oracle is not configured on the reserve.
export const KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER = KLEND_PROGRAM_ID;

const LENDING_MARKET_AUTH_SEED = Buffer.from("lma");
const RESERVE_LIQUIDITY_SUPPLY_SEED = Buffer.from("reserve_liq_supply");
const RESERVE_FEE_RECEIVER_SEED = Buffer.from("fee_receiver");
const RESERVE_COLLATERAL_MINT_SEED = Buffer.from("reserve_coll_mint");
const RESERVE_COLLATERAL_SUPPLY_SEED = Buffer.from("reserve_coll_supply");

export type KaminoReserveOracleAccounts = {
    pythOracle: PublicKey;
    switchboardPriceOracle: PublicKey;
    switchboardTwapOracle: PublicKey;
    scopePrices: PublicKey;
};

export type KaminoTokenModeRuntimeAccounts = KaminoReserveOracleAccounts & {
    moduleConfig: PublicKey;
    kaminoModuleState: PublicKey;
    moduleUnderlyingTokenAccount: PublicKey;
    vaultCollateralAccount: PublicKey;
    vaultTokenAccount: PublicKey;
};

export function deriveKlendLendingMarketAuthority(
    lendingMarket: PublicKey = KAMINO_MAIN_MARKET
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [LENDING_MARKET_AUTH_SEED, lendingMarket.toBuffer()],
        KLEND_PROGRAM_ID
    )[0];
}

export function deriveKlendReservePdas(
    reserve: PublicKey = KAMINO_SOL_RESERVE
): {
    reserveLiquiditySupply: PublicKey;
    reserveFeeReceiver: PublicKey;
    reserveCollateralMint: PublicKey;
    reserveCollateralSupply: PublicKey;
} {
    return {
        reserveLiquiditySupply: PublicKey.findProgramAddressSync(
            [RESERVE_LIQUIDITY_SUPPLY_SEED, reserve.toBuffer()],
            KLEND_PROGRAM_ID
        )[0],
        reserveFeeReceiver: PublicKey.findProgramAddressSync(
            [RESERVE_FEE_RECEIVER_SEED, reserve.toBuffer()],
            KLEND_PROGRAM_ID
        )[0],
        reserveCollateralMint: PublicKey.findProgramAddressSync(
            [RESERVE_COLLATERAL_MINT_SEED, reserve.toBuffer()],
            KLEND_PROGRAM_ID
        )[0],
        reserveCollateralSupply: PublicKey.findProgramAddressSync(
            [RESERVE_COLLATERAL_SUPPLY_SEED, reserve.toBuffer()],
            KLEND_PROGRAM_ID
        )[0],
    };
}

export const KAMINO_SOL_RESERVE_PDAS = deriveKlendReservePdas();

export const KAMINO_SOL_STATIC_ACCOUNTS = {
    klendProgram: KLEND_PROGRAM_ID,
    lendingMarket: KAMINO_MAIN_MARKET,
    kaminoReserve: KAMINO_SOL_RESERVE,
    underlyingMint: KAMINO_SOL_UNDERLYING_MINT,
    reserveLiquidityMint: KAMINO_SOL_UNDERLYING_MINT,
    lendingMarketAuthority: deriveKlendLendingMarketAuthority(),
    reserveLiquiditySupply: KAMINO_SOL_RESERVE_PDAS.reserveLiquiditySupply,
    reserveFeeReceiver: KAMINO_SOL_RESERVE_PDAS.reserveFeeReceiver,
    reserveCollateralMint: KAMINO_SOL_RESERVE_PDAS.reserveCollateralMint,
    reserveCollateralSupply: KAMINO_SOL_RESERVE_PDAS.reserveCollateralSupply,
    tokenProgram: TOKEN_PROGRAM_ID,
    liquidityTokenProgram: TOKEN_PROGRAM_ID,
    instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
};

// Use this only as an explicit placeholder while discovering a reserve's oracle config.
// A real test must replace every configured oracle with the pubkey read from the reserve.
export const EMPTY_KAMINO_ORACLE_ACCOUNTS: KaminoReserveOracleAccounts = {
    pythOracle: KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER,
    switchboardPriceOracle: KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER,
    switchboardTwapOracle: KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER,
    scopePrices: KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER,
};

// Oracle accounts discovered from the real SOL reserve through Surfpool.
// Missing optional oracles use KLEND_PROGRAM_ID as the klend-interface placeholder.
export const KAMINO_SOL_ORACLE_ACCOUNTS: KaminoReserveOracleAccounts = {
    pythOracle: KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER,
    switchboardPriceOracle: KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER,
    switchboardTwapOracle: KLEND_OPTIONAL_ACCOUNT_PLACEHOLDER,
    scopePrices: new PublicKey("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH"),
};

export function kaminoDepositRemainingAccounts(
    accounts: KaminoTokenModeRuntimeAccounts
): Array<{ pubkey: PublicKey; isWritable: boolean; isSigner: boolean }> {
    return [
        { pubkey: accounts.moduleConfig, isWritable: false, isSigner: false },
        { pubkey: accounts.kaminoModuleState, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.kaminoReserve, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.lendingMarket, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.lendingMarketAuthority, isWritable: false, isSigner: false },
        { pubkey: accounts.pythOracle, isWritable: false, isSigner: false },
        { pubkey: accounts.switchboardPriceOracle, isWritable: false, isSigner: false },
        { pubkey: accounts.switchboardTwapOracle, isWritable: false, isSigner: false },
        { pubkey: accounts.scopePrices, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.reserveLiquidityMint, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.reserveLiquiditySupply, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.reserveCollateralMint, isWritable: true, isSigner: false },
        { pubkey: accounts.moduleUnderlyingTokenAccount, isWritable: true, isSigner: false },
        { pubkey: accounts.vaultCollateralAccount, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.tokenProgram, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.liquidityTokenProgram, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.klendProgram, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.instructionSysvar, isWritable: false, isSigner: false },
    ];
}

export function kaminoWithdrawRemainingAccounts(
    accounts: KaminoTokenModeRuntimeAccounts
): Array<{ pubkey: PublicKey; isWritable: boolean; isSigner: boolean }> {
    return [
        { pubkey: accounts.moduleConfig, isWritable: false, isSigner: false },
        { pubkey: accounts.kaminoModuleState, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.lendingMarket, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.kaminoReserve, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.lendingMarketAuthority, isWritable: false, isSigner: false },
        { pubkey: accounts.pythOracle, isWritable: false, isSigner: false },
        { pubkey: accounts.switchboardPriceOracle, isWritable: false, isSigner: false },
        { pubkey: accounts.switchboardTwapOracle, isWritable: false, isSigner: false },
        { pubkey: accounts.scopePrices, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.reserveLiquidityMint, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.reserveCollateralMint, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.reserveLiquiditySupply, isWritable: true, isSigner: false },
        { pubkey: accounts.vaultCollateralAccount, isWritable: true, isSigner: false },
        { pubkey: accounts.vaultTokenAccount, isWritable: true, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.tokenProgram, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.liquidityTokenProgram, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.klendProgram, isWritable: false, isSigner: false },
        { pubkey: KAMINO_SOL_STATIC_ACCOUNTS.instructionSysvar, isWritable: false, isSigner: false },
    ];
}
