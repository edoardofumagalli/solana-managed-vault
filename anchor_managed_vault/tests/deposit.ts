import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { DEFAULT_MAX_FLOAT_BPS, manager, program } from "./helpers/setup";
import {
    deriveShareMintPda,
    deriveVaultPda,
    deriveVaultTokenAccount,
} from "./helpers/pda";
import {
    createTokenAccount,
    createUnderlyingMint,
    fetchMint,
    fetchTokenAccount,
    mintTokens,
    transferTokens,
} from "./helpers/token";

describe("deposit", () => {
    it("mints shares 1:1 for the first depositor", async () => {
        const depositAmount = 1_000_000;

        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        await program.methods
            .initializeVault(DEFAULT_MAX_FLOAT_BPS)
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

        const depositorUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            manager
        );
        const depositorShareTokenAccount = await createTokenAccount(
            shareMint,
            manager
        );

        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            depositAmount
        );

        await program.methods
            .deposit(new anchor.BN(depositAmount))
            .accountsPartial({
                depositor: manager,
                vault,
                underlyingMint,
                depositorUnderlyingTokenAccount,
                shareMint,
                vaultTokenAccount,
                depositorShareTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const depositorUnderlying = await fetchTokenAccount(
            depositorUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(vaultTokenAccount);
        const depositorShares = await fetchTokenAccount(
            depositorShareTokenAccount
        );
        const shareMintAccount = await fetchMint(shareMint);

        assert.equal(depositorUnderlying.amount.toString(), "0");
        assert.equal(vaultUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(depositorShares.amount.toString(), depositAmount.toString());
        assert.equal(shareMintAccount.supply.toString(), depositAmount.toString());
    });

    it("rejects zero amount", async () => {
        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        await program.methods
            .initializeVault(DEFAULT_MAX_FLOAT_BPS)
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

        const depositorUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            manager
        );
        const depositorShareTokenAccount = await createTokenAccount(
            shareMint,
            manager
        );

        try {
            await program.methods
                .deposit(new anchor.BN(0))
                .accountsPartial({
                    depositor: manager,
                    vault,
                    underlyingMint,
                    depositorUnderlyingTokenAccount,
                    shareMint,
                    vaultTokenAccount,
                    depositorShareTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            assert.fail("Expected deposit to reject zero amount");
        } catch (error) {
            assert.include(String(error), "InvalidAmount");
        }
    });

    it("rounds down shares when division is not exact", async () => {
        const firstDepositAmount = 1_000_000;
        const donationAmount = 1;
        const secondDepositAmount = 1_000_000;
        const virtualAssets = new anchor.BN(1_000);
        const virtualShares = new anchor.BN(1_000);

        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        await program.methods
            .initializeVault(DEFAULT_MAX_FLOAT_BPS)
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

        const depositorUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            manager
        );
        const depositorShareTokenAccount = await createTokenAccount(
            shareMint,
            manager
        );

        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            firstDepositAmount
        );

        await program.methods
            .deposit(new anchor.BN(firstDepositAmount))
            .accountsPartial({
                depositor: manager,
                vault,
                underlyingMint,
                depositorUnderlyingTokenAccount,
                shareMint,
                vaultTokenAccount,
                depositorShareTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            donationAmount
        );
        await transferTokens(
            depositorUnderlyingTokenAccount,
            vaultTokenAccount,
            donationAmount
        );

        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            secondDepositAmount
        );

        const totalAssetsBeforeSecondDeposit = new anchor.BN(
            firstDepositAmount + donationAmount
        );
        const totalSharesBeforeSecondDeposit = new anchor.BN(firstDepositAmount);

        const expectedSecondShares = new anchor.BN(secondDepositAmount)
            .mul(totalSharesBeforeSecondDeposit.add(virtualShares))
            .div(totalAssetsBeforeSecondDeposit.add(virtualAssets));

        await program.methods
            .deposit(new anchor.BN(secondDepositAmount))
            .accountsPartial({
                depositor: manager,
                vault,
                underlyingMint,
                depositorUnderlyingTokenAccount,
                shareMint,
                vaultTokenAccount,
                depositorShareTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const vaultUnderlying = await fetchTokenAccount(vaultTokenAccount);
        const depositorShares = await fetchTokenAccount(
            depositorShareTokenAccount
        );
        const shareMintAccount = await fetchMint(shareMint);

        const expectedTotalVaultAssets = new anchor.BN(
            firstDepositAmount + donationAmount + secondDepositAmount
        );
        const expectedTotalShares = new anchor.BN(firstDepositAmount).add(
            expectedSecondShares
        );

        assert.equal(
            vaultUnderlying.amount.toString(),
            expectedTotalVaultAssets.toString()
        );
        assert.equal(
            depositorShares.amount.toString(),
            expectedTotalShares.toString()
        );
        assert.equal(
            shareMintAccount.supply.toString(),
            expectedTotalShares.toString()
        );
        assert.isBelow(expectedSecondShares.toNumber(), secondDepositAmount);
    });

    it("rejects a nonzero deposit that would mint zero shares", async () => {
        const donationAmount = 1_000_000;
        const depositAmount = 1;

        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        await program.methods
            .initializeVault(DEFAULT_MAX_FLOAT_BPS)
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

        const depositorUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            manager
        );
        const depositorShareTokenAccount = await createTokenAccount(
            shareMint,
            manager
        );

        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            donationAmount
        );
        await transferTokens(
            depositorUnderlyingTokenAccount,
            vaultTokenAccount,
            donationAmount
        );

        await mintTokens(
            underlyingMint,
            depositorUnderlyingTokenAccount,
            depositAmount
        );

        try {
            await program.methods
                .deposit(new anchor.BN(depositAmount))
                .accountsPartial({
                    depositor: manager,
                    vault,
                    underlyingMint,
                    depositorUnderlyingTokenAccount,
                    shareMint,
                    vaultTokenAccount,
                    depositorShareTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            assert.fail("Expected deposit to reject zero-share output");
        } catch (error) {
            assert.include(String(error), "ZeroShares");
        }

        const depositorUnderlying = await fetchTokenAccount(
            depositorUnderlyingTokenAccount
        );
        const vaultUnderlying = await fetchTokenAccount(vaultTokenAccount);
        const depositorShares = await fetchTokenAccount(
            depositorShareTokenAccount
        );
        const shareMintAccount = await fetchMint(shareMint);

        assert.equal(depositorUnderlying.amount.toString(), depositAmount.toString());
        assert.equal(vaultUnderlying.amount.toString(), donationAmount.toString());
        assert.equal(depositorShares.amount.toString(), "0");
        assert.equal(shareMintAccount.supply.toString(), "0");
    });

    it("keeps a donation attack unprofitable and preserves accounting", async () => {
        const attackerDepositAmount = 1;
        const donationAmount = 1_000_000;
        const victimDepositAmount = 1_000_000;
        const virtualAssets = new anchor.BN(1_000);
        const virtualShares = new anchor.BN(1_000);

        const attacker = Keypair.generate();
        const victim = Keypair.generate();

        const underlyingMint = await createUnderlyingMint();

        const [vault] = deriveVaultPda(underlyingMint);
        const [shareMint] = deriveShareMintPda(vault);
        const vaultTokenAccount = deriveVaultTokenAccount(underlyingMint, vault);

        await program.methods
            .initializeVault(DEFAULT_MAX_FLOAT_BPS)
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

        const attackerUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            attacker.publicKey
        );
        const attackerShareTokenAccount = await createTokenAccount(
            shareMint,
            attacker.publicKey
        );
        const victimUnderlyingTokenAccount = await createTokenAccount(
            underlyingMint,
            victim.publicKey
        );
        const victimShareTokenAccount = await createTokenAccount(
            shareMint,
            victim.publicKey
        );

        await mintTokens(
            underlyingMint,
            attackerUnderlyingTokenAccount,
            attackerDepositAmount + donationAmount
        );

        await program.methods
            .deposit(new anchor.BN(attackerDepositAmount))
            .accountsPartial({
                depositor: attacker.publicKey,
                vault,
                underlyingMint,
                depositorUnderlyingTokenAccount: attackerUnderlyingTokenAccount,
                shareMint,
                vaultTokenAccount,
                depositorShareTokenAccount: attackerShareTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([attacker])
            .rpc();

        await transferTokens(
            attackerUnderlyingTokenAccount,
            vaultTokenAccount,
            donationAmount,
            attacker
        );

        await mintTokens(
            underlyingMint,
            victimUnderlyingTokenAccount,
            victimDepositAmount
        );

        const attackerShares = new anchor.BN(attackerDepositAmount);
        const totalAssetsBeforeVictimDeposit = new anchor.BN(
            attackerDepositAmount + donationAmount
        );
        const totalSharesBeforeVictimDeposit = attackerShares;
        const expectedVictimShares = new anchor.BN(victimDepositAmount)
            .mul(totalSharesBeforeVictimDeposit.add(virtualShares))
            .div(totalAssetsBeforeVictimDeposit.add(virtualAssets));

        await program.methods
            .deposit(new anchor.BN(victimDepositAmount))
            .accountsPartial({
                depositor: victim.publicKey,
                vault,
                underlyingMint,
                depositorUnderlyingTokenAccount: victimUnderlyingTokenAccount,
                shareMint,
                vaultTokenAccount,
                depositorShareTokenAccount: victimShareTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([victim])
            .rpc();

        const vaultUnderlying = await fetchTokenAccount(vaultTokenAccount);
        const attackerSharesAccount = await fetchTokenAccount(
            attackerShareTokenAccount
        );
        const victimSharesAccount = await fetchTokenAccount(victimShareTokenAccount);
        const shareMintAccount = await fetchMint(shareMint);

        const totalAssetsAfterVictimDeposit = new anchor.BN(
            attackerDepositAmount + donationAmount + victimDepositAmount
        );
        const totalSharesAfterVictimDeposit = attackerShares.add(
            expectedVictimShares
        );
        const attackerRecoverableAssets = attackerShares
            .mul(totalAssetsAfterVictimDeposit.add(virtualAssets))
            .div(totalSharesAfterVictimDeposit.add(virtualShares));
        const attackerCost = new anchor.BN(
            attackerDepositAmount + donationAmount
        );

        assert.equal(
            vaultUnderlying.amount.toString(),
            totalAssetsAfterVictimDeposit.toString()
        );
        assert.equal(attackerSharesAccount.amount.toString(), attackerShares.toString());
        assert.equal(
            victimSharesAccount.amount.toString(),
            expectedVictimShares.toString()
        );
        assert.equal(
            shareMintAccount.supply.toString(),
            totalSharesAfterVictimDeposit.toString()
        );
        assert.isTrue(expectedVictimShares.gt(new anchor.BN(0)));
        assert.isTrue(attackerRecoverableAssets.lt(attackerCost));
    });
});
