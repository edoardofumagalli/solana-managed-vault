import { assert } from "chai";
import { PublicKey } from "@solana/web3.js";

export function assertPublicKeyEquals(
    actual: PublicKey | null | undefined,
    expected: PublicKey,
    message?: string
) {
    assert.ok(actual, message ?? `Expected public key to be defined`);
    assert.ok(
        actual.equals(expected),
        message ?? `Expected ${actual.toBase58()} to equal ${expected.toBase58()}`
    );
}
