import { AccountInfo, PublicKey } from "@solana/web3.js";

import { connection } from "./setup";

export type SurfpoolRpcResponse = {
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
};

type SurfpoolConnection = typeof connection & {
    _rpcRequest(method: string, args: unknown[]): Promise<SurfpoolRpcResponse>;
};

export async function surfpoolRpc(
    method: string,
    args: unknown[]
): Promise<unknown> {
    const response = await (connection as SurfpoolConnection)._rpcRequest(
        method,
        args
    );

    if (response.error) {
        throw new Error(`${method} failed: ${JSON.stringify(response.error)}`);
    }

    return response.result;
}

export async function fetchAccountInfoOrFail(
    address: PublicKey,
    label: string
): Promise<AccountInfo<Buffer>> {
    const accountInfo = await connection.getAccountInfo(address);

    if (!accountInfo) {
        throw new Error(`${label} must exist on the local surfnet`);
    }

    return accountInfo;
}

export async function setSurfpoolTokenAccountBalance(
    owner: PublicKey,
    mint: PublicKey,
    amount: number
): Promise<void> {
    await surfpoolRpc("surfnet_setTokenAccount", [
        owner.toBase58(),
        mint.toBase58(),
        { amount },
    ]);
}

export async function timeTravelToSlot(slot: number): Promise<void> {
    await surfpoolRpc("surfnet_timeTravel", [{ absoluteSlot: slot }]);
}
