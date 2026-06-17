import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export const FIXTURE_SCHEMA = "managed-vault.backendFixture.v1";

export const VAULT_SEED = Buffer.from("vault");
export const SHARE_MINT_SEED = Buffer.from("share_mint");
export const USER_VAULT_POSITION_SEED = Buffer.from("user_vault_position");
export const MODULE_CALL_AUTHORITY_SEED = Buffer.from("module_call_authority");
export const MODULE_ENTRY_SEED = Buffer.from("module_entry");
export const MOCK_MODULE_STATE_SEED = Buffer.from("mock_module_state");
export const MOCK_MODULE_AUTHORITY_SEED = Buffer.from("mock_module_authority");
export const KAMINO_MODULE_CONFIG_SEED = Buffer.from("module_config");
export const KAMINO_MODULE_STATE_SEED = Buffer.from("kamino_module_state");

export const DEFAULT_OUTPUT = ".tmp/backend-fixture.json";
export const DEFAULT_RPC_URL =
    process.env.MANAGED_VAULT_RPC_URL ||
    process.env.ANCHOR_PROVIDER_URL ||
    "http://127.0.0.1:8899";
export const DEFAULT_WALLET_PATH =
    process.env.ANCHOR_WALLET || "~/.config/solana/id.json";
export const DEFAULT_DECIMALS = 6;
export const DEFAULT_MAX_FLOAT_BPS = 2_000;
export const DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS = "8";
export const DEFAULT_MINT_AMOUNT = "1000000";
export const DEFAULT_DEPOSIT_AMOUNT = "1000000";
export const DEFAULT_SHARES_TO_WITHDRAW = "250000";
export const DEFAULT_MODULE_POLICY_SEED = "0";
export const DEFAULT_KAMINO_MODULE_POLICY_SEED = "0";
export const DEFAULT_MODULE_AMOUNT = "100000";
export const DEFAULT_KAMINO_MODULE_RECALL_AMOUNT = "50000";
export const MODULE_TYPE_TOKEN = 0;
export const MAX_U64 = new anchor.BN("18446744073709551615");
export const MAX_SAFE_TOKEN_AMOUNT = new anchor.BN(
    Number.MAX_SAFE_INTEGER.toString()
);

export const KLEND_PROGRAM_ID = new PublicKey(
    "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

export const KAMINO_USDC = {
    lendingMarket: new PublicKey(
        "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
    ),
    reserve: new PublicKey("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"),
    liquidityMint: new PublicKey(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ),
    liquiditySupplyVault: new PublicKey(
        "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6"
    ),
    collateralMint: new PublicKey(
        "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"
    ),
    scopePrices: new PublicKey("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH"),
    lendingMarketAuthority: new PublicKey(
        "9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo"
    ),
};
