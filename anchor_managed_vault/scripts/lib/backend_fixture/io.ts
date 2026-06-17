import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { SetupArgs } from "./types";

export function writeJson(outputPath: string, value: unknown): void {
    const resolvedPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, `${JSON.stringify(value, null, 2)}\n`);
    console.log(`\nFixture written to ${resolvedPath}`);
}

export function expandHome(inputPath: string): string {
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

export function loadKeypair(walletPath: string): Keypair {
    const resolvedPath = path.resolve(expandHome(walletPath));
    const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

    if (!Array.isArray(secretKey)) {
        throw new Error("Wallet file must contain a JSON array secret key");
    }

    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

export function createProvider(args: SetupArgs): {
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
