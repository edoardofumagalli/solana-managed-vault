import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
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
import * as fs from "fs";
import * as path from "path";

import { AnchorManagedVault } from "../target/types/anchor_managed_vault";
import { MockYieldModule } from "../target/types/mock_yield_module";

const FIXTURE_SCHEMA = "managed-vault.backendFixture.v1";

const VAULT_SEED = Buffer.from("vault");
const SHARE_MINT_SEED = Buffer.from("share_mint");
const USER_VAULT_POSITION_SEED = Buffer.from("user_vault_position");
const MODULE_ENTRY_SEED = Buffer.from("module_entry");
const MOCK_MODULE_STATE_SEED = Buffer.from("mock_module_state");
const MOCK_MODULE_AUTHORITY_SEED = Buffer.from("mock_module_authority");

const DEFAULT_OUTPUT = ".tmp/backend-fixture.json";
const DEFAULT_RPC_URL =
    process.env.MANAGED_VAULT_RPC_URL ||
    process.env.ANCHOR_PROVIDER_URL ||
    "http://127.0.0.1:8899";
const DEFAULT_WALLET_PATH =
    process.env.ANCHOR_WALLET || "~/.config/solana/id.json";
const DEFAULT_DECIMALS = 6;
const DEFAULT_MAX_FLOAT_BPS = 2_000;
const DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS = "8";
const DEFAULT_MINT_AMOUNT = "1000000";
const DEFAULT_DEPOSIT_AMOUNT = "1000000";
const DEFAULT_SHARES_TO_WITHDRAW = "250000";
const DEFAULT_MODULE_POLICY_SEED = "0";
const DEFAULT_MODULE_AMOUNT = "100000";
const MAX_U64 = new anchor.BN("18446744073709551615");
const MAX_SAFE_TOKEN_AMOUNT = new anchor.BN(Number.MAX_SAFE_INTEGER.toString());

type SetupArgs = {
    execute: boolean;
    includeMockModule: boolean;
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
    moduleAmount: string;
    user?: PublicKey;
    emergencyAdmin?: PublicKey;
};

type RemainingAccountJson = {
    pubkey: string;
    isWritable: boolean;
    isSigner: boolean;
    role: string;
};

type MockYieldModuleFixtureJson = {
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

type FixtureJson = {
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
        mockYield: MockYieldModuleFixtureJson;
    };
};

function usageError(message: string): Error & { showUsage?: boolean } {
    const error = new Error(message) as Error & { showUsage?: boolean };
    error.showUsage = true;
    return error;
}

function parseArgs(argv: string[]): SetupArgs {
    const args: SetupArgs = {
        execute: false,
        includeMockModule: false,
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
        moduleAmount: DEFAULT_MODULE_AMOUNT,
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
        } else if (key === "module-amount") {
            args.moduleAmount = parsePositiveU64String(key, value);
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

    return args;
}

function parseBoundedInteger(
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

function parseU64String(field: string, value: string): string {
    if (!/^\d+$/.test(value)) {
        throw usageError(`${field} must be a u64 integer string`);
    }

    const parsed = new anchor.BN(value);
    if (parsed.gt(MAX_U64)) {
        throw usageError(`${field} must fit in u64`);
    }

    return value;
}

function parsePositiveU64String(field: string, value: string): string {
    const parsed = parseU64String(field, value);

    if (new anchor.BN(parsed).isZero()) {
        throw usageError(`${field} must be greater than zero`);
    }

    return parsed;
}

function parseSafeTokenAmount(field: string, value: string): number {
    const parsed = new anchor.BN(parseU64String(field, value));

    if (parsed.gt(MAX_SAFE_TOKEN_AMOUNT)) {
        throw usageError(
            `${field} must be <= Number.MAX_SAFE_INTEGER for this local setup script`
        );
    }

    return parsed.toNumber();
}

function parsePublicKey(field: string, value: string): PublicKey {
    try {
        return new PublicKey(value);
    } catch {
        throw usageError(`${field} must be a valid Solana public key`);
    }
}

function printUsage(): void {
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
    [--include-mock-module] \\
    [--mock-module-policy-seed 0] \\
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

Environment:
  MANAGED_VAULT_RPC_URL or ANCHOR_PROVIDER_URL can be used instead of --rpc-url.
  ANCHOR_WALLET can be used instead of --wallet.
`);
}

function deriveVaultPda(
    programId: PublicKey,
    underlyingMint: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [VAULT_SEED, underlyingMint.toBuffer()],
        programId
    );
}

function deriveShareMintPda(
    programId: PublicKey,
    vault: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SHARE_MINT_SEED, vault.toBuffer()],
        programId
    );
}

function deriveUserVaultPositionPda(
    programId: PublicKey,
    vault: PublicKey,
    user: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [USER_VAULT_POSITION_SEED, vault.toBuffer(), user.toBuffer()],
        programId
    );
}

function deriveModuleEntryPda(
    programId: PublicKey,
    vault: PublicKey,
    moduleProgramId: PublicKey,
    policySeed: string
): [PublicKey, number] {
    const policySeedBytes = new anchor.BN(policySeed).toArrayLike(
        Buffer,
        "le",
        8
    );

    return PublicKey.findProgramAddressSync(
        [
            MODULE_ENTRY_SEED,
            vault.toBuffer(),
            moduleProgramId.toBuffer(),
            policySeedBytes,
        ],
        programId
    );
}

function deriveMockModuleStatePda(
    vault: PublicKey,
    mockYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MOCK_MODULE_STATE_SEED, vault.toBuffer()],
        mockYieldModuleProgramId
    );
}

function deriveMockModuleAuthorityPda(
    mockModuleState: PublicKey,
    mockYieldModuleProgramId: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [MOCK_MODULE_AUTHORITY_SEED, mockModuleState.toBuffer()],
        mockYieldModuleProgramId
    );
}

function remainingAccount(
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

function mockDeployRemainingAccounts(
    moduleState: PublicKey,
    moduleTokenAccount: PublicKey
): RemainingAccountJson[] {
    return [
        remainingAccount(moduleState, true, "mock_module_state"),
        remainingAccount(moduleTokenAccount, true, "module_token_account"),
    ];
}

function mockRecallRemainingAccounts(params: {
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

function writeJson(outputPath: string, value: unknown): void {
    const resolvedPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, `${JSON.stringify(value, null, 2)}\n`);
    console.log(`\nFixture written to ${resolvedPath}`);
}

function expandHome(inputPath: string): string {
    if (inputPath === "~") {
        return process.env.HOME ?? inputPath;
    }

    if (inputPath.startsWith("~/")) {
        const home = process.env.HOME;
        if (!home) {
            throw new Error("Cannot expand ~ because HOME is not set");
        }
        return path.join(home, inputPath.slice(2));
    }

    return inputPath;
}

function loadKeypair(walletPath: string): Keypair {
    const resolvedPath = path.resolve(expandHome(walletPath));
    const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

    if (!Array.isArray(secretKey)) {
        throw new Error("Wallet file must contain a JSON array secret key");
    }

    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function createProvider(args: SetupArgs): {
    provider: AnchorProvider;
    payer: Keypair;
} {
    const payer = loadKeypair(args.walletPath);
    const wallet = new anchor.Wallet(payer);
    const connection = new Connection(args.rpcUrl, "confirmed");
    const provider = new AnchorProvider(
        connection,
        wallet,
        AnchorProvider.defaultOptions()
    );

    return {
        provider,
        payer,
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
    console.log(`include mock module: ${args.includeMockModule}`);
    console.log(`mock module policy seed: ${args.mockModulePolicySeed}`);
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
        console.log("Initializing mock yield module...");

        const [mockModuleState] = deriveMockModuleStatePda(
            vault,
            mockYieldModuleProgram.programId
        );
        const [mockModuleAuthority] = deriveMockModuleAuthorityPda(
            mockModuleState,
            mockYieldModuleProgram.programId
        );
        const moduleTokenAccount = getAssociatedTokenAddressSync(
            underlyingMint,
            mockModuleAuthority,
            true,
            TOKEN_PROGRAM_ID
        );
        const [moduleEntry] = deriveModuleEntryPda(
            program.programId,
            vault,
            mockYieldModuleProgram.programId,
            args.mockModulePolicySeed
        );

        const initializeMockModule = await mockYieldModuleProgram.methods
            .initialize(program.programId)
            .accountsPartial({
                payer: manager,
                vault,
                underlyingMint,
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
            underlyingMint,
            moduleTokenAccount,
            vaultTokenAccount,
        });

        mockYieldModuleFixture = {
            programId: mockYieldModuleProgram.programId.toBase58(),
            policySeed: args.mockModulePolicySeed,
            accounts: {
                moduleEntry: moduleEntry.toBase58(),
                moduleProgram: mockYieldModuleProgram.programId.toBase58(),
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
                    vault: vault.toBase58(),
                    manager: manager.toBase58(),
                    moduleProgram: mockYieldModuleProgram.programId.toBase58(),
                    moduleState: mockModuleState.toBase58(),
                    moduleUnderlyingTokenAccount: moduleTokenAccount.toBase58(),
                    policySeed: args.mockModulePolicySeed,
                    simulate: true,
                },
                syncNav: {
                    vault: vault.toBase58(),
                    moduleEntry: moduleEntry.toBase58(),
                    feePayer: manager.toBase58(),
                    simulate: true,
                },
                deploy: {
                    vault: vault.toBase58(),
                    manager: manager.toBase58(),
                    moduleEntry: moduleEntry.toBase58(),
                    amount: args.moduleAmount,
                    remainingAccounts: deployRemainingAccounts,
                    simulate: true,
                },
                recall: {
                    vault: vault.toBase58(),
                    manager: manager.toBase58(),
                    moduleEntry: moduleEntry.toBase58(),
                    amount: args.moduleAmount,
                    remainingAccounts: recallRemainingAccounts,
                    simulate: true,
                },
            },
            transactions: {
                initializeMockModule,
            },
        };
    }

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
        modules: mockYieldModuleFixture
            ? {
                  mockYield: mockYieldModuleFixture,
              }
            : undefined,
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
