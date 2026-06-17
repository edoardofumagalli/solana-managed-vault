import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { KAMINO_USDC, KLEND_PROGRAM_ID } from "./constants";
import { RemainingAccountJson } from "./types";

export function remainingAccount(
    pubkey: PublicKey,
    isWritable: boolean,
    role: string
): RemainingAccountJson {
    return {
        pubkey: pubkey.toBase58(),
        isWritable,
        isSigner: false,
        role,
    };
}

export function mockDeployRemainingAccounts(
    moduleState: PublicKey,
    moduleTokenAccount: PublicKey
): RemainingAccountJson[] {
    return [
        remainingAccount(moduleState, true, "mock_module_state"),
        remainingAccount(moduleTokenAccount, true, "module_token_account"),
    ];
}

export function mockRecallRemainingAccounts(params: {
    moduleState: PublicKey;
    mockModuleAuthority: PublicKey;
    underlyingMint: PublicKey;
    moduleTokenAccount: PublicKey;
    vaultTokenAccount: PublicKey;
}): RemainingAccountJson[] {
    return [
        remainingAccount(params.moduleState, true, "mock_module_state"),
        remainingAccount(
            params.mockModuleAuthority,
            false,
            "mock_module_authority"
        ),
        remainingAccount(params.underlyingMint, false, "underlying_mint"),
        remainingAccount(
            params.moduleTokenAccount,
            true,
            "module_token_account"
        ),
        remainingAccount(params.vaultTokenAccount, true, "vault_token_account"),
        remainingAccount(TOKEN_PROGRAM_ID, false, "token_program"),
    ];
}

export function kaminoDeployRemainingAccounts(params: {
    moduleConfig: PublicKey;
    moduleState: PublicKey;
    moduleUnderlyingTokenAccount: PublicKey;
    vaultCollateralAccount: PublicKey;
}): RemainingAccountJson[] {
    return [
        remainingAccount(params.moduleConfig, false, "module_config"),
        remainingAccount(params.moduleState, true, "kamino_module_state"),
        remainingAccount(KAMINO_USDC.reserve, true, "reserve"),
        remainingAccount(KAMINO_USDC.lendingMarket, false, "lending_market"),
        remainingAccount(
            KAMINO_USDC.lendingMarketAuthority,
            false,
            "lending_market_authority"
        ),
        remainingAccount(KLEND_PROGRAM_ID, false, "pyth_oracle"),
        remainingAccount(KLEND_PROGRAM_ID, false, "switchboard_price_oracle"),
        remainingAccount(KLEND_PROGRAM_ID, false, "switchboard_twap_oracle"),
        remainingAccount(KAMINO_USDC.scopePrices, false, "scope_prices"),
        remainingAccount(KAMINO_USDC.liquidityMint, false, "liquidity_mint"),
        remainingAccount(
            KAMINO_USDC.liquiditySupplyVault,
            true,
            "liquidity_supply_vault"
        ),
        remainingAccount(KAMINO_USDC.collateralMint, true, "collateral_mint"),
        remainingAccount(
            params.moduleUnderlyingTokenAccount,
            true,
            "module_underlying_token_account"
        ),
        remainingAccount(
            params.vaultCollateralAccount,
            true,
            "vault_collateral_account"
        ),
        remainingAccount(TOKEN_PROGRAM_ID, false, "token_program"),
        remainingAccount(TOKEN_PROGRAM_ID, false, "liquidity_token_program"),
        remainingAccount(KLEND_PROGRAM_ID, false, "klend_program"),
        remainingAccount(
            SYSVAR_INSTRUCTIONS_PUBKEY,
            false,
            "instruction_sysvar"
        ),
    ];
}

export function kaminoRecallRemainingAccounts(params: {
    moduleConfig: PublicKey;
    moduleState: PublicKey;
    moduleUnderlyingTokenAccount: PublicKey;
    vaultCollateralAccount: PublicKey;
    vaultTokenAccount: PublicKey;
}): RemainingAccountJson[] {
    return [
        remainingAccount(params.moduleConfig, false, "module_config"),
        remainingAccount(params.moduleState, true, "kamino_module_state"),
        remainingAccount(KAMINO_USDC.lendingMarket, false, "lending_market"),
        remainingAccount(KAMINO_USDC.reserve, true, "reserve"),
        remainingAccount(
            KAMINO_USDC.lendingMarketAuthority,
            false,
            "lending_market_authority"
        ),
        remainingAccount(KLEND_PROGRAM_ID, false, "pyth_oracle"),
        remainingAccount(KLEND_PROGRAM_ID, false, "switchboard_price_oracle"),
        remainingAccount(KLEND_PROGRAM_ID, false, "switchboard_twap_oracle"),
        remainingAccount(KAMINO_USDC.scopePrices, false, "scope_prices"),
        remainingAccount(KAMINO_USDC.liquidityMint, false, "liquidity_mint"),
        remainingAccount(KAMINO_USDC.collateralMint, true, "collateral_mint"),
        remainingAccount(
            KAMINO_USDC.liquiditySupplyVault,
            true,
            "liquidity_supply_vault"
        ),
        remainingAccount(
            params.vaultCollateralAccount,
            true,
            "vault_collateral_account"
        ),
        remainingAccount(
            params.moduleUnderlyingTokenAccount,
            true,
            "module_underlying_token_account"
        ),
        remainingAccount(params.vaultTokenAccount, true, "vault_token_account"),
        remainingAccount(TOKEN_PROGRAM_ID, false, "token_program"),
        remainingAccount(TOKEN_PROGRAM_ID, false, "liquidity_token_program"),
        remainingAccount(KLEND_PROGRAM_ID, false, "klend_program"),
        remainingAccount(
            SYSVAR_INSTRUCTIONS_PUBKEY,
            false,
            "instruction_sysvar"
        ),
    ];
}
