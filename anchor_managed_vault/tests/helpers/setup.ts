import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { AnchorManagedVault } from "../../target/types/anchor_managed_vault";

anchor.setProvider(anchor.AnchorProvider.env());

export const provider = anchor.getProvider() as AnchorProvider;
export const connection = provider.connection;
export const wallet = provider.wallet;
export const payer = (wallet as typeof wallet & { payer: Keypair }).payer;

export const program = anchor.workspace
    .anchorManagedVault as Program<AnchorManagedVault>;

export const manager = wallet.publicKey;

export const DEFAULT_MAX_FLOAT_BPS = 2_000;
export const INVALID_MAX_FLOAT_BPS = 10_001;
