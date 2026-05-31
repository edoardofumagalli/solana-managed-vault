import fs from "fs";
import path from "path";

const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";

const PROGRAMS: Record<
    string,
    {
        programId: string;
        binaryPath: string;
        idlPath: string;
    }
> = {
    anchor_managed_vault: {
        programId: "AZjFTHJFBduuqPf1Gtado4r59rJ8zYqSNFPhiYFDUDzr",
        binaryPath: "target/deploy/anchor_managed_vault.so",
        idlPath: "target/idl/anchor_managed_vault.json",
    },
    kamino_yield_module: {
        programId: "9YBJD5JjCfzLcPPSczbxM9QNUfV53fU9WGrpsoWCS2qm",
        binaryPath: "target/deploy/kamino_yield_module.so",
        idlPath: "target/idl/kamino_yield_module.json",
    },
    mock_yield_module: {
        programId: "AFPVi8LB8iwXAGLr72AqaG6aH8pwVYzfR5ArCiiceBWe",
        binaryPath: "target/deploy/mock_yield_module.so",
        idlPath: "target/idl/mock_yield_module.json",
    },
};

type JsonRpcResponse = {
    result?: unknown;
    error?: unknown;
};

async function rpc(method: string, params: unknown) {
    const response = await fetch(RPC_URL, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params,
        }),
    });

    const payload = (await response.json()) as JsonRpcResponse;

    if (!response.ok || payload.error) {
        throw new Error(
            `${method} failed: ${JSON.stringify(payload.error ?? payload)}`
        );
    }

    return payload.result;
}

function resolveFile(relativePath: string): string {
    return path.resolve(process.cwd(), relativePath);
}

async function writeProgram(programName: string) {
    const program = PROGRAMS[programName];

    if (!program) {
        throw new Error(
            `Unknown program "${programName}". Expected one of: ${Object.keys(
                PROGRAMS
            ).join(", ")}`
        );
    }

    const binaryPath = resolveFile(program.binaryPath);
    const idlPath = resolveFile(program.idlPath);

    if (!fs.existsSync(binaryPath)) {
        throw new Error(`Program binary not found: ${binaryPath}`);
    }

    const binary = fs.readFileSync(binaryPath);
    const authority = process.env.SURFPOOL_PROGRAM_AUTHORITY;

    console.log(`Surfpool RPC: ${RPC_URL}`);
    console.log(`Writing ${programName}`);
    console.log(`program id: ${program.programId}`);
    console.log(`binary: ${binaryPath}`);
    console.log(`size: ${binary.length} bytes`);

    const writeProgramParams = authority
        ? [program.programId, `0x${binary.toString("hex")}`, 0, authority]
        : [program.programId, `0x${binary.toString("hex")}`, 0];

    await rpc("surfnet_writeProgram", writeProgramParams);

    console.log("program data written");

    if (fs.existsSync(idlPath)) {
        const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
        idl.address = program.programId;

        await rpc("surfnet_registerIdl", [idl]);

        console.log(`IDL registered: ${idlPath}`);
    } else {
        console.log(`IDL not found, skipped: ${idlPath}`);
    }
}

const programName = process.argv[2];

if (!programName) {
    console.error(
        `Usage: npx ts-node scripts/surfpool-write-program.ts <${Object.keys(
            PROGRAMS
        ).join("|")}>`
    );
    process.exit(1);
}

writeProgram(programName).catch((error) => {
    console.error(error);
    process.exit(1);
});
