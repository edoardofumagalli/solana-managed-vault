import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { KaminoYieldModule } from "../../../target/types/kamino_yield_module";
import {
  DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS,
  connection,
  manager,
  payer,
  program,
} from "../../helpers/setup";
import {
  deriveKaminoModuleConfigPda,
  deriveKaminoModuleStatePda,
  deriveModuleCallAuthorityPda,
  deriveModuleEntryPda,
  deriveShareMintPda,
  deriveVaultPda,
  deriveVaultTokenAccount,
} from "../../helpers/pda";
import { assertPublicKeyEquals } from "../../helpers/assertions";
import {
  fetchAccountInfoOrFail,
  setSurfpoolTokenAccountBalance,
  timeTravelToSlot,
} from "../../helpers/surfpool";

declare const process: {
  env: Record<string, string | undefined>;
};

const kaminoYieldModuleProgram = anchor.workspace
  .kaminoYieldModule as Program<KaminoYieldModule>;

const RUN_REAL_FLOW = process.env.RUN_KAMINO_REAL_FLOW === "1";
const SIMULATE_ONLY = process.env.KAMINO_REAL_FLOW_SIMULATE_ONLY === "1";

const MODULE_TYPE_TOKEN = 0;
const MAX_FLOAT_BPS = 2_000;
const VAULT_DEPOSIT_AMOUNT = 10_000_000;
const MODULE_DEPLOY_AMOUNT = 1_000_000;
const MODULE_RECALL_AMOUNT = 500_000;
const COMPUTE_UNIT_LIMIT = 1_000_000;

const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

const KAMINO_USDC = {
  lendingMarket: new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"),
  reserve: new PublicKey("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"),
  liquidityMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  liquiditySupplyVault: new PublicKey(
    "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6"
  ),
  collateralMint: new PublicKey("B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"),
  scopePrices: new PublicKey("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH"),
  lendingMarketAuthority: new PublicKey(
    "9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo"
  ),
};

type RealKaminoSetup = {
  vault: PublicKey;
  shareMint: PublicKey;
  vaultTokenAccount: PublicKey;
  moduleCallAuthority: PublicKey;
  moduleConfig: PublicKey;
  kaminoModuleState: PublicKey;
  moduleUnderlyingTokenAccount: PublicKey;
  vaultCollateralAccount: PublicKey;
  moduleEntry: PublicKey;
};

type SimulatableRpcBuilder = {
  transaction(): Promise<anchor.web3.Transaction>;
  rpc(): Promise<string>;
};

async function assertRealKaminoAccountsAreCloned(): Promise<void> {
  const klendProgram = await fetchAccountInfoOrFail(
    KLEND_PROGRAM_ID,
    "Klend program"
  );
  assert.isTrue(klendProgram.executable, "Klend program must be executable");

  const lendingMarket = await fetchAccountInfoOrFail(
    KAMINO_USDC.lendingMarket,
    "Kamino lending market"
  );
  assertPublicKeyEquals(lendingMarket.owner, KLEND_PROGRAM_ID);

  const reserve = await fetchAccountInfoOrFail(
    KAMINO_USDC.reserve,
    "Kamino USDC reserve"
  );
  assertPublicKeyEquals(reserve.owner, KLEND_PROGRAM_ID);

  const liquidityMint = await fetchAccountInfoOrFail(
    KAMINO_USDC.liquidityMint,
    "USDC mint"
  );
  assertPublicKeyEquals(liquidityMint.owner, TOKEN_PROGRAM_ID);

  const collateralMint = await fetchAccountInfoOrFail(
    KAMINO_USDC.collateralMint,
    "Kamino collateral mint"
  );
  assertPublicKeyEquals(collateralMint.owner, TOKEN_PROGRAM_ID);

  const liquiditySupply = await getAccount(
    connection,
    KAMINO_USDC.liquiditySupplyVault,
    undefined,
    TOKEN_PROGRAM_ID
  );
  assertPublicKeyEquals(liquiditySupply.mint, KAMINO_USDC.liquidityMint);
  assertPublicKeyEquals(
    liquiditySupply.owner,
    KAMINO_USDC.lendingMarketAuthority
  );

  const scopePrices = await fetchAccountInfoOrFail(
    KAMINO_USDC.scopePrices,
    "Scope prices oracle"
  );
  assert.isAbove(scopePrices.data.length, 0, "Scope prices must have data");
}

async function createAta(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false
): Promise<PublicKey> {
  return createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    mint,
    owner,
    undefined,
    TOKEN_PROGRAM_ID,
    undefined,
    allowOwnerOffCurve
  );
}

async function ensureSurfpoolSlotAfterReserveLastUpdate(): Promise<void> {
  const reserve = await fetchAccountInfoOrFail(
    KAMINO_USDC.reserve,
    "Kamino USDC reserve"
  );
  const reserveLastUpdateSlot = Number(reserve.data.readBigUInt64LE(16));
  const currentSlot = await connection.getSlot();
  const targetSlot = reserveLastUpdateSlot + 1;

  if (currentSlot >= targetSlot) {
    return;
  }

  console.log(
    `time traveling Surfpool from slot ${currentSlot} to ${targetSlot}`
  );

  await timeTravelToSlot(targetSlot);

  const updatedSlot = await connection.getSlot();
  assert.isAtLeast(updatedSlot, targetSlot);
}

async function ensureVault(
  vault: PublicKey,
  shareMint: PublicKey,
  vaultTokenAccount: PublicKey
): Promise<void> {
  const existingVault = await connection.getAccountInfo(vault);

  if (!existingVault) {
    const emergencyAdmin = Keypair.generate();

    await program.methods
      .initializeVault(
        MAX_FLOAT_BPS,
        emergencyAdmin.publicKey,
        DEFAULT_MANAGER_WITHDRAW_DELAY_SLOTS
      )
      .accountsPartial({
        manager,
        underlyingMint: KAMINO_USDC.liquidityMint,
        vault,
        shareMint,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  const vaultState = await program.account.vault.fetch(vault);
  assertPublicKeyEquals(vaultState.manager, manager);
  assertPublicKeyEquals(vaultState.underlyingMint, KAMINO_USDC.liquidityMint);
  assertPublicKeyEquals(vaultState.shareMint, shareMint);
  assertPublicKeyEquals(vaultState.vaultTokenAccount, vaultTokenAccount);
}

async function ensureKaminoModule(
  vault: PublicKey,
  moduleConfig: PublicKey,
  kaminoModuleState: PublicKey
): Promise<void> {
  const existingState = await connection.getAccountInfo(kaminoModuleState);

  if (!existingState) {
    await kaminoYieldModuleProgram.methods
      .initialize({
        vaultProgramId: program.programId,
        lendingMarket: KAMINO_USDC.lendingMarket,
        kaminoReserve: KAMINO_USDC.reserve,
        moduleType: MODULE_TYPE_TOKEN,
        obligation: PublicKey.default,
      })
      .accountsPartial({
        payer: manager,
        vault,
        moduleConfig,
        kaminoModuleState,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  const moduleConfigState =
    await kaminoYieldModuleProgram.account.moduleConfig.fetch(moduleConfig);
  const moduleState =
    await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
      kaminoModuleState
    );

  assertPublicKeyEquals(moduleConfigState.vault, vault);
  assertPublicKeyEquals(moduleConfigState.vaultProgramId, program.programId);
  assertPublicKeyEquals(
    moduleConfigState.lendingMarket,
    KAMINO_USDC.lendingMarket
  );
  assertPublicKeyEquals(moduleConfigState.kaminoReserve, KAMINO_USDC.reserve);
  assert.equal(moduleConfigState.moduleType, MODULE_TYPE_TOKEN);

  assertPublicKeyEquals(moduleState.vault, vault);
  assertPublicKeyEquals(moduleState.vaultProgramId, program.programId);
  assertPublicKeyEquals(moduleState.lendingMarket, KAMINO_USDC.lendingMarket);
  assertPublicKeyEquals(moduleState.kaminoReserve, KAMINO_USDC.reserve);
  assert.equal(moduleState.moduleType, MODULE_TYPE_TOKEN);
  assert.isTrue(moduleState.isInitialized);
}

async function registerFreshKaminoModule(
  setup: Omit<RealKaminoSetup, "moduleEntry">
): Promise<PublicKey> {
  const policySeed = new anchor.BN(Date.now());
  const [moduleEntry] = deriveModuleEntryPda(
    setup.vault,
    kaminoYieldModuleProgram.programId,
    policySeed
  );

  await program.methods
    .registerModule(policySeed)
    .accountsPartial({
      manager,
      vault: setup.vault,
      moduleEntry,
      moduleState: setup.kaminoModuleState,
      moduleUnderlyingTokenAccount: setup.moduleUnderlyingTokenAccount,
      moduleProgram: kaminoYieldModuleProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return moduleEntry;
}

async function setupRealKaminoFlow(): Promise<RealKaminoSetup> {
  await assertRealKaminoAccountsAreCloned();
  await ensureSurfpoolSlotAfterReserveLastUpdate();

  const [vault] = deriveVaultPda(KAMINO_USDC.liquidityMint);
  const [shareMint] = deriveShareMintPda(vault);
  const vaultTokenAccount = deriveVaultTokenAccount(
    KAMINO_USDC.liquidityMint,
    vault
  );
  const [moduleCallAuthority] = deriveModuleCallAuthorityPda(vault);
  const [moduleConfig] = deriveKaminoModuleConfigPda(
    vault,
    kaminoYieldModuleProgram.programId
  );
  const [kaminoModuleState] = deriveKaminoModuleStatePda(
    vault,
    kaminoYieldModuleProgram.programId
  );
  const moduleUnderlyingTokenAccount = getAssociatedTokenAddressSync(
    KAMINO_USDC.liquidityMint,
    kaminoModuleState,
    true,
    TOKEN_PROGRAM_ID
  );
  const vaultCollateralAccount = getAssociatedTokenAddressSync(
    KAMINO_USDC.collateralMint,
    kaminoModuleState,
    true,
    TOKEN_PROGRAM_ID
  );

  await ensureVault(vault, shareMint, vaultTokenAccount);
  await ensureKaminoModule(vault, moduleConfig, kaminoModuleState);
  await createAta(KAMINO_USDC.liquidityMint, kaminoModuleState, true);
  await createAta(KAMINO_USDC.collateralMint, kaminoModuleState, true);

  const moduleEntry = await registerFreshKaminoModule({
    vault,
    shareMint,
    vaultTokenAccount,
    moduleCallAuthority,
    moduleConfig,
    kaminoModuleState,
    moduleUnderlyingTokenAccount,
    vaultCollateralAccount,
  });

  return {
    vault,
    shareMint,
    vaultTokenAccount,
    moduleCallAuthority,
    moduleConfig,
    kaminoModuleState,
    moduleUnderlyingTokenAccount,
    vaultCollateralAccount,
    moduleEntry,
  };
}

async function depositUsdcIntoVault(setup: RealKaminoSetup): Promise<void> {
  const depositorUnderlyingTokenAccount = await createAta(
    KAMINO_USDC.liquidityMint,
    manager
  );
  const depositorShareTokenAccount = await createAta(setup.shareMint, manager);

  await setSurfpoolTokenAccountBalance(
    manager,
    KAMINO_USDC.liquidityMint,
    VAULT_DEPOSIT_AMOUNT
  );

  await program.methods
    .deposit(new anchor.BN(VAULT_DEPOSIT_AMOUNT))
    .accountsPartial({
      depositor: manager,
      vault: setup.vault,
      underlyingMint: KAMINO_USDC.liquidityMint,
      depositorUnderlyingTokenAccount,
      shareMint: setup.shareMint,
      vaultTokenAccount: setup.vaultTokenAccount,
      depositorShareTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

function kaminoDepositRemainingAccounts(setup: RealKaminoSetup): AccountMeta[] {
  return [
    { pubkey: setup.moduleConfig, isWritable: false, isSigner: false },
    { pubkey: setup.kaminoModuleState, isWritable: true, isSigner: false },
    { pubkey: KAMINO_USDC.reserve, isWritable: true, isSigner: false },
    { pubkey: KAMINO_USDC.lendingMarket, isWritable: false, isSigner: false },
    {
      pubkey: KAMINO_USDC.lendingMarketAuthority,
      isWritable: false,
      isSigner: false,
    },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KAMINO_USDC.scopePrices, isWritable: false, isSigner: false },
    { pubkey: KAMINO_USDC.liquidityMint, isWritable: false, isSigner: false },
    {
      pubkey: KAMINO_USDC.liquiditySupplyVault,
      isWritable: true,
      isSigner: false,
    },
    { pubkey: KAMINO_USDC.collateralMint, isWritable: true, isSigner: false },
    {
      pubkey: setup.moduleUnderlyingTokenAccount,
      isWritable: true,
      isSigner: false,
    },
    { pubkey: setup.vaultCollateralAccount, isWritable: true, isSigner: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isWritable: false, isSigner: false },
  ];
}

function kaminoWithdrawRemainingAccounts(
  setup: RealKaminoSetup
): AccountMeta[] {
  return [
    { pubkey: setup.moduleConfig, isWritable: false, isSigner: false },
    { pubkey: setup.kaminoModuleState, isWritable: true, isSigner: false },
    { pubkey: KAMINO_USDC.lendingMarket, isWritable: false, isSigner: false },
    { pubkey: KAMINO_USDC.reserve, isWritable: true, isSigner: false },
    {
      pubkey: KAMINO_USDC.lendingMarketAuthority,
      isWritable: false,
      isSigner: false,
    },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KAMINO_USDC.scopePrices, isWritable: false, isSigner: false },
    { pubkey: KAMINO_USDC.liquidityMint, isWritable: false, isSigner: false },
    { pubkey: KAMINO_USDC.collateralMint, isWritable: true, isSigner: false },
    {
      pubkey: KAMINO_USDC.liquiditySupplyVault,
      isWritable: true,
      isSigner: false,
    },
    { pubkey: setup.vaultCollateralAccount, isWritable: true, isSigner: false },
    {
      pubkey: setup.moduleUnderlyingTokenAccount,
      isWritable: true,
      isSigner: false,
    },
    { pubkey: setup.vaultTokenAccount, isWritable: true, isSigner: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: KLEND_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isWritable: false, isSigner: false },
  ];
}

function deployBuilder(setup: RealKaminoSetup, amount: number) {
  return program.methods
    .deployToModule(new anchor.BN(amount))
    .accountsPartial({
      manager,
      vault: setup.vault,
      moduleCallAuthority: setup.moduleCallAuthority,
      moduleEntry: setup.moduleEntry,
      underlyingMint: KAMINO_USDC.liquidityMint,
      vaultTokenAccount: setup.vaultTokenAccount,
      moduleUnderlyingTokenAccount: setup.moduleUnderlyingTokenAccount,
      moduleProgram: kaminoYieldModuleProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(kaminoDepositRemainingAccounts(setup))
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: COMPUTE_UNIT_LIMIT,
      }),
    ]);
}

function recallBuilder(setup: RealKaminoSetup, amount: number) {
  return program.methods
    .recallFromModule(new anchor.BN(amount))
    .accountsPartial({
      manager,
      vault: setup.vault,
      moduleCallAuthority: setup.moduleCallAuthority,
      moduleEntry: setup.moduleEntry,
      underlyingMint: KAMINO_USDC.liquidityMint,
      vaultTokenAccount: setup.vaultTokenAccount,
      moduleProgram: kaminoYieldModuleProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(kaminoWithdrawRemainingAccounts(setup))
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: COMPUTE_UNIT_LIMIT,
      }),
    ]);
}

async function simulateAndSend(
  label: string,
  build: () => SimulatableRpcBuilder
): Promise<string | null> {
  console.log(`${label}: simulating`);

  const tx = await build().transaction();
  const { blockhash } = await connection.getLatestBlockhash();
  tx.feePayer = manager;
  tx.recentBlockhash = blockhash;
  tx.sign(payer);

  const simulation = await connection.simulateTransaction(tx);
  const logs = simulation.value.logs ?? [];
  const lastLogs = logs.slice(Math.max(logs.length - 8, 0));

  for (const log of lastLogs) {
    console.log(`${label}: ${log}`);
  }

  if (simulation.value.err) {
    throw new Error(
      `${label} simulation failed: ${JSON.stringify(simulation.value.err)}`
    );
  }

  if (SIMULATE_ONLY) {
    return null;
  }

  console.log(`${label}: sending local transaction`);

  return build().rpc();
}

const describeRealKamino = RUN_REAL_FLOW ? describe : describe.skip;

describeRealKamino("kamino_yield_module real USDC flow on Surfpool", () => {
  it("simulates and executes deploy/recall through the real Klend USDC reserve", async () => {
    const setup = await setupRealKaminoFlow();

    await depositUsdcIntoVault(setup);

    const vaultTokenBeforeDeploy = await getAccount(
      connection,
      setup.vaultTokenAccount,
      undefined,
      TOKEN_PROGRAM_ID
    );
    assert.isAtLeast(
      Number(vaultTokenBeforeDeploy.amount),
      MODULE_DEPLOY_AMOUNT
    );

    const deploySignature = await simulateAndSend("deploy_to_module", () =>
      deployBuilder(setup, MODULE_DEPLOY_AMOUNT)
    );

    if (SIMULATE_ONLY) {
      assert.isNull(deploySignature);
      return;
    }

    const collateralAfterDeploy = await getAccount(
      connection,
      setup.vaultCollateralAccount,
      undefined,
      TOKEN_PROGRAM_ID
    );
    assert.isAbove(
      Number(collateralAfterDeploy.amount),
      0,
      "Kamino collateral account should receive collateral tokens"
    );

    const moduleStateAfterDeploy =
      await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
        setup.kaminoModuleState
      );
    assert.isAbove(
      moduleStateAfterDeploy.cachedNav.toNumber(),
      0,
      "Kamino module NAV should be positive after deploy"
    );

    const recallSignature = await simulateAndSend("recall_from_module", () =>
      recallBuilder(setup, MODULE_RECALL_AMOUNT)
    );
    assert.isString(recallSignature);

    const vaultTokenAfterRecall = await getAccount(
      connection,
      setup.vaultTokenAccount,
      undefined,
      TOKEN_PROGRAM_ID
    );
    assert.isAtLeast(
      Number(vaultTokenAfterRecall.amount),
      Number(vaultTokenBeforeDeploy.amount) -
        MODULE_DEPLOY_AMOUNT +
        MODULE_RECALL_AMOUNT
    );

    const moduleEntryState = await program.account.moduleEntry.fetch(
      setup.moduleEntry
    );
    const vaultState = await program.account.vault.fetch(setup.vault);

    assertPublicKeyEquals(
      moduleEntryState.moduleState,
      setup.kaminoModuleState
    );
    assert.isAbove(moduleEntryState.cachedNav.toNumber(), 0);
    assert.isAtLeast(vaultState.modulesNavTotal.toNumber(), 0);

    console.log(`deploy signature: ${deploySignature}`);
    console.log(`recall signature: ${recallSignature}`);
  });
});
