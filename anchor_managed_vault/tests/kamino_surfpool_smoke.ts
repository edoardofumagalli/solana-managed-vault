import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { KaminoYieldModule } from "../target/types/kamino_yield_module";
import { connection, manager, program } from "./helpers/setup";
import { createTokenAccount, createUnderlyingMint, mintTokens } from "./helpers/token";
import {
    deriveKaminoModuleConfigPda,
    deriveKaminoModuleStatePda,
} from "./helpers/pda";
import { assertPublicKeyEquals } from "./helpers/assertions";
import {
    KAMINO_MAIN_MARKET,
    KAMINO_SOL_RESERVE,
    KLEND_PROGRAM_ID,
} from "./fixtures/kamino";

const kaminoYieldModuleProgram = anchor.workspace
    .kaminoYieldModule as Program<KaminoYieldModule>;

const MODULE_TYPE_TOKEN = 0;
const RUN_SURFPOOL_KAMINO = process.env.RUN_SURFPOOL_KAMINO === "1";
const describeSurfpool = RUN_SURFPOOL_KAMINO ? describe : describe.skip;

describeSurfpool("kamino_yield_module Surfpool smoke", () => {
    it("reads the real SOL reserve and calculates token-mode NAV", async () => {
        const reserveAccount = await connection.getAccountInfo(KAMINO_SOL_RESERVE);
        assert.isNotNull(
            reserveAccount,
            "Expected Surfpool to clone the SOL reserve account"
        );
        assertPublicKeyEquals(reserveAccount!.owner, KLEND_PROGRAM_ID);
        assert.isAbove(reserveAccount!.data.length, 0);

        // This local token account is only a nonzero position input for calculate_nav.
        // The smoke test still prices that amount with the real Surfpool-cloned reserve.
        const positionMint = await createUnderlyingMint();
        const localPositionTokenAccount = await createTokenAccount(
            positionMint,
            manager
        );
        await mintTokens(positionMint, localPositionTokenAccount, 1_000_000);

        const vault = Keypair.generate().publicKey;
        const [moduleConfig] = deriveKaminoModuleConfigPda(
            vault,
            kaminoYieldModuleProgram.programId
        );
        const [kaminoModuleState] = deriveKaminoModuleStatePda(
            vault,
            kaminoYieldModuleProgram.programId
        );

        await kaminoYieldModuleProgram.methods
            .initialize({
                vaultProgramId: program.programId,
                lendingMarket: KAMINO_MAIN_MARKET,
                kaminoReserve: KAMINO_SOL_RESERVE,
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

        await kaminoYieldModuleProgram.methods
            .calculateNav()
            .accountsPartial({
                payer: manager,
                vault,
                kaminoModuleState,
                kaminoReserve: KAMINO_SOL_RESERVE,
                vaultCollateralAccount: localPositionTokenAccount,
                // Unused in token mode. The real obligation path is covered separately.
                obligation: KAMINO_SOL_RESERVE,
            })
            .rpc();

        const moduleState =
            await kaminoYieldModuleProgram.account.kaminoModuleState.fetch(
                kaminoModuleState
            );

        assertPublicKeyEquals(moduleState.vault, vault);
        assertPublicKeyEquals(moduleState.kaminoReserve, KAMINO_SOL_RESERVE);
        assertPublicKeyEquals(moduleState.lendingMarket, KAMINO_MAIN_MARKET);
        assert.isTrue(
            moduleState.cachedNav.gt(new anchor.BN(0)),
            "Expected NAV to be positive for a nonzero local position priced with the real reserve"
        );
    });
});
