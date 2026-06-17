import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import {
    DEFAULT_DECIMALS,
    DEFAULT_DEPOSIT_AMOUNT,
    DEFAULT_KAMINO_MODULE_POLICY_SEED,
    DEFAULT_KAMINO_MODULE_RECALL_AMOUNT,
    DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
    DEFAULT_MAX_FLOAT_BPS,
    DEFAULT_MINT_AMOUNT,
    DEFAULT_MODULE_AMOUNT,
    DEFAULT_MODULE_POLICY_SEED,
    DEFAULT_OUTPUT,
    DEFAULT_RPC_URL,
    DEFAULT_SHARES_TO_WITHDRAW,
    DEFAULT_WALLET_PATH,
    MAX_SAFE_TOKEN_AMOUNT,
    MAX_U64,
} from "./constants";
import { SetupArgs } from "./types";

export function usageError(message: string): Error & { showUsage?: boolean } {
    const error = new Error(message) as Error & { showUsage?: boolean };
    error.showUsage = true;
    return error;
}

export function parseArgs(argv: string[]): SetupArgs {
    const args: SetupArgs = {
        execute: false,
        includeMockModule: false,
        includeKaminoUsdcModule: false,
        setupKaminoUsdcOnchain: false,
        output: DEFAULT_OUTPUT,
        rpcUrl: DEFAULT_RPC_URL,
        walletPath: DEFAULT_WALLET_PATH,
        decimals: DEFAULT_DECIMALS,
        maxFloatBps: DEFAULT_MAX_FLOAT_BPS,
        managerWithdrawDelaySlots: DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
        mintAmount: DEFAULT_MINT_AMOUNT,
        depositAmount: DEFAULT_DEPOSIT_AMOUNT,
        sharesToWithdraw: DEFAULT_SHARES_TO_WITHDRAW,
        mockModulePolicySeed: DEFAULT_MODULE_POLICY_SEED,
        kaminoModulePolicySeed: DEFAULT_KAMINO_MODULE_POLICY_SEED,
        moduleAmount: DEFAULT_MODULE_AMOUNT,
        kaminoModuleRecallAmount: DEFAULT_KAMINO_MODULE_RECALL_AMOUNT,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--execute") {
            args.execute = true;
            continue;
        }

        if (arg === "--include-mock-module") {
            args.includeMockModule = true;
            continue;
        }

        if (arg === "--include-kamino-usdc-module") {
            args.includeKaminoUsdcModule = true;
            continue;
        }

        if (arg === "--setup-kamino-usdc-onchain") {
            args.setupKaminoUsdcOnchain = true;
            args.includeKaminoUsdcModule = true;
            continue;
        }

        if (!arg.startsWith("--")) {
            throw usageError(`Unexpected argument: ${arg}`);
        }

        const key = arg.slice(2);
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) {
            throw usageError(`Missing value for ${arg}`);
        }

        if (key === "output") {
            args.output = value;
        } else if (key === "rpc-url") {
            args.rpcUrl = value;
        } else if (key === "wallet") {
            args.walletPath = value;
        } else if (key === "decimals") {
            args.decimals = parseBoundedInteger(key, value, 0, 255);
        } else if (key === "max-float-bps") {
            args.maxFloatBps = parseBoundedInteger(key, value, 0, 10_000);
        } else if (key === "manager-withdraw-delay-slots") {
            args.managerWithdrawDelaySlots = parseU64String(key, value);
        } else if (key === "mint-amount") {
            args.mintAmount = parseU64String(key, value);
        } else if (key === "deposit-amount") {
            args.depositAmount = parsePositiveU64String(key, value);
        } else if (key === "shares-to-withdraw") {
            args.sharesToWithdraw = parsePositiveU64String(key, value);
        } else if (key === "mock-module-policy-seed") {
            args.mockModulePolicySeed = parseU64String(key, value);
        } else if (key === "kamino-module-policy-seed") {
            args.kaminoModulePolicySeed = parseU64String(key, value);
        } else if (key === "module-amount") {
            args.moduleAmount = parsePositiveU64String(key, value);
        } else if (key === "kamino-module-recall-amount") {
            args.kaminoModuleRecallAmount = parsePositiveU64String(key, value);
        } else if (key === "user") {
            args.user = parsePublicKey(key, value);
        } else if (key === "emergency-admin") {
            args.emergencyAdmin = parsePublicKey(key, value);
        } else {
            throw usageError(`Unknown argument: ${arg}`);
        }

        index += 1;
    }

    if (new anchor.BN(args.depositAmount).gt(new anchor.BN(args.mintAmount))) {
        throw usageError("deposit-amount cannot be greater than mint-amount");
    }

    if (
        new anchor.BN(args.kaminoModuleRecallAmount).gt(
            new anchor.BN(args.moduleAmount)
        )
    ) {
        throw usageError(
            "kamino-module-recall-amount cannot be greater than module-amount"
        );
    }

    if (args.setupKaminoUsdcOnchain) {
        args.includeKaminoUsdcModule = true;
    }

    return args;
}

export function parseBoundedInteger(
    field: string,
    value: string,
    min: number,
    max: number
): number {
    const parsed = Number.parseInt(value, 10);
    if (
        !Number.isSafeInteger(parsed) ||
        String(parsed) !== value ||
        parsed < min ||
        parsed > max
    ) {
        throw usageError(
            `${field} must be an integer between ${min} and ${max}`
        );
    }

    return parsed;
}

export function parseU64String(field: string, value: string): string {
    if (!/^\d+$/.test(value)) {
        throw usageError(`${field} must be a u64 integer string`);
    }

    const parsed = new anchor.BN(value);
    if (parsed.gt(MAX_U64)) {
        throw usageError(`${field} must fit in u64`);
    }

    return value;
}

export function parsePositiveU64String(field: string, value: string): string {
    const parsed = parseU64String(field, value);

    if (new anchor.BN(parsed).isZero()) {
        throw usageError(`${field} must be greater than zero`);
    }

    return parsed;
}

export function parseSafeTokenAmount(field: string, value: string): number {
    const parsed = new anchor.BN(parseU64String(field, value));

    if (parsed.gt(MAX_SAFE_TOKEN_AMOUNT)) {
        throw usageError(
            `${field} must be <= Number.MAX_SAFE_INTEGER for this local setup script`
        );
    }

    return parsed.toNumber();
}

export function parsePublicKey(field: string, value: string): PublicKey {
    try {
        return new PublicKey(value);
    } catch {
        throw usageError(`${field} must be a valid Solana public key`);
    }
}

export function printUsage(): void {
    console.log(`
Usage:
  npm run backend:fixture:setup -- \\
    --execute \\
    [--output .tmp/backend-fixture.json] \\
    [--rpc-url http://127.0.0.1:8899] \\
    [--wallet ~/.config/solana/id.json] \\
    [--mint-amount 1000000] \\
    [--deposit-amount 1000000] \\
    [--shares-to-withdraw 250000] \\
    [--module-amount 100000] \\
    [--kamino-module-recall-amount 50000] \\
    [--include-mock-module] \\
    [--mock-module-policy-seed 0] \\
    [--include-kamino-usdc-module] \\
    [--setup-kamino-usdc-onchain] \\
    [--kamino-module-policy-seed 0] \\
    [--user <user_pubkey>] \\
    [--emergency-admin <admin_pubkey>] \\
    [--decimals 6] \\
    [--max-float-bps 2000] \\
    [--manager-withdraw-delay-slots 8]

Default behavior:
  Without --execute this script only prints the setup plan and exits.

Output:
  Writes a backend fixture JSON file with vault, mint, token account, and suggested amount values.
  With --include-mock-module, also initializes the mock yield module and writes module endpoint request templates.
  With --include-kamino-usdc-module, also writes static Surfpool/Kamino USDC module request templates.
  With --setup-kamino-usdc-onchain, also initializes the Kamino USDC vault and Kamino module state on a Surfpool/Kamino localnet.

Environment:
  MANAGED_VAULT_RPC_URL or ANCHOR_PROVIDER_URL can be used instead of --rpc-url.
  ANCHOR_WALLET can be used instead of --wallet.
`);
}
