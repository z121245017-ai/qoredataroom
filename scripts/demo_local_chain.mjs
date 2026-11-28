#!/usr/bin/env node
/**
 * 1-Command Local Diana EVM (chainId 9800) Judge Verification for QoreDataRoom.
 *
 * Boots an ephemeral Anvil node (chainId 9800, Cancun EVM), mounts QoreChain's
 * 0x...0a01 (pqcVerify) & 0x...0a02 (pqcKeyStatus) precompiles, broadcasts
 * `DeployDiana.s.sol:DeployDiana`, verifies deployed `eth_getCode`, creates a
 * PQC-gated M&A room, anchors an Epoch 1 ciphertext commitment, and executes an
 * on-chain ML-DSA-87 `evictMemberWithPqcProof` rotation into Epoch 2.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CONTRACTS_DIR = path.join(ROOT_DIR, "contracts");

// Standard deterministic Anvil local dev accounts (#0..#2) — never used on live networks
const ANVIL_PK_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BIDDER_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BIDDER_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PQC_VERIFY_PRECOMPILE = "0x0000000000000000000000000000000000000a01";
const PQC_KEY_STATUS_PRECOMPILE = "0x0000000000000000000000000000000000000a02";

const ENV = {
  ...process.env,
  PATH: `${path.join(os.homedir(), ".foundry", "bin")}:${process.env.PATH || ""}`,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
};

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

function rpcCall(port, method, params = []) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            else resolve(parsed.result);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function waitForAnvil(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const chainHex = await rpcCall(port, "eth_chainId");
      if (chainHex === "0x2648") return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out waiting for local Anvil (chainId 9800) to start");
}

function runFoundry(bin, args, extraEnv = {}) {
  return execFileSync(bin, args, {
    cwd: CONTRACTS_DIR,
    env: { ...ENV, ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main() {
  const port = await getFreePort();
  const rpcUrl = `http://127.0.0.1:${port}`;

  console.log("=== QoreDataRoom Local Diana EVM (chainId 9800) End-to-End Simulation ===");
  runFoundry("forge", ["build", "--quiet"]);

  const verifyArtifact = JSON.parse(
    fs.readFileSync(path.join(CONTRACTS_DIR, "out", "DataRoomRegistry.t.sol", "MockQorePQCVerify.json"), "utf8"),
  );
  const statusArtifact = JSON.parse(
    fs.readFileSync(path.join(CONTRACTS_DIR, "out", "DataRoomRegistry.t.sol", "MockQorePQCKeyStatus.json"), "utf8"),
  );

  const anvil = spawn(
    "anvil",
    ["--chain-id", "9800", "--hardfork", "cancun", "--port", String(port), "--silent"],
    { env: ENV, stdio: "ignore" },
  );

  try {
    await waitForAnvil(port);
    console.log(`[1/6] Local Anvil (Cancun) booted at ${rpcUrl} (chainId = 9800 / 0x2648)`);

    await rpcCall(port, "anvil_setCode", [PQC_VERIFY_PRECOMPILE, verifyArtifact.deployedBytecode.object]);
    await rpcCall(port, "anvil_setCode", [PQC_KEY_STATUS_PRECOMPILE, statusArtifact.deployedBytecode.object]);
    console.log(`[2/6] Mounted QoreChain PQC precompiles 0x...0a01 (pqcVerify) & 0x...0a02 (pqcKeyStatus)`);

    runFoundry(
      "forge",
      [
        "script",
        "script/DeployDiana.s.sol:DeployDiana",
        "--rpc-url",
        rpcUrl,
        "--broadcast",
        "--legacy",
      ],
      { PRIVATE_KEY: ANVIL_PK_0 },
    );

    const broadcastFile = path.join(
      CONTRACTS_DIR,
      "broadcast",
      "DeployDiana.s.sol",
      "9800",
      "run-latest.json",
    );
    const broadcast = JSON.parse(fs.readFileSync(broadcastFile, "utf8"));
    const deployTx = broadcast.transactions.find((t) => t.transactionType === "CREATE");
    assert.ok(deployTx, "CREATE tx missing from DeployDiana broadcast");
    const registryAddr = deployTx.contractAddress;
    const deployHash = deployTx.hash;

    const deployedCode = await rpcCall(port, "eth_getCode", [registryAddr, "latest"]);
    const codeBytes = (deployedCode.length - 2) / 2;
    assert.ok(codeBytes > 100, "DataRoomRegistry eth_getCode unexpectedly empty");
    console.log(`[3/6] Deployed DataRoomRegistry.sol at ${registryAddr} (${codeBytes} B runtime code, tx ${deployHash})`);

    const ownerPqPubkey = "0x" + Buffer.from("ML-DSA-87-OWNER-DEMO-PUBKEY-9800").toString("hex");
    const bidderAPqPubkey = "0x" + Buffer.from("ML-DSA-87-BIDDER-A-DEMO-PUBKEY").toString("hex");
    const bidderBPqPubkey = "0x" + Buffer.from("ML-DSA-87-BIDDER-B-DEMO-PUBKEY").toString("hex");

    for (const [acct, pkHex] of [
      [OWNER, ownerPqPubkey],
      [BIDDER_A, bidderAPqPubkey],
      [BIDDER_B, bidderBPqPubkey],
    ]) {
      runFoundry("cast", [
        "send",
        PQC_KEY_STATUS_PRECOMPILE,
        "setKeyStatus(address,bool,uint8,bytes,bool)",
        acct,
        "true",
        "1",
        pkHex,
        "true",
        "--rpc-url",
        rpcUrl,
        "--private-key",
        ANVIL_PK_0,
      ]);
    }

    const roomId = runFoundry("cast", ["keccak", "PROJECT-HELIOS-LOCAL-DIANA-9800"]);
    const ownerKemHash = runFoundry("cast", ["keccak", "OWNER-ML-KEM-1024-PK"]);
    const bidderAKemHash = runFoundry("cast", ["keccak", "BIDDER-A-ML-KEM-1024-PK"]);
    const bidderBKemHash = runFoundry("cast", ["keccak", "BIDDER-B-ML-KEM-1024-PK"]);

    runFoundry("cast", [
      "send",
      registryAddr,
      "createRoom(bytes32,string,bytes32,bytes)",
      roomId,
      "Project Helios - M&A VDR",
      ownerKemHash,
      ownerPqPubkey,
      "--rpc-url",
      rpcUrl,
      "--private-key",
      ANVIL_PK_0,
    ]);
    runFoundry("cast", [
      "send",
      registryAddr,
      "addMember(bytes32,address,uint8,bytes32)",
      roomId,
      BIDDER_A,
      "2",
      bidderAKemHash,
      "--rpc-url",
      rpcUrl,
      "--private-key",
      ANVIL_PK_0,
    ]);
    runFoundry("cast", [
      "send",
      registryAddr,
      "addMember(bytes32,address,uint8,bytes32)",
      roomId,
      BIDDER_B,
      "2",
      bidderBKemHash,
      "--rpc-url",
      rpcUrl,
      "--private-key",
      ANVIL_PK_0,
    ]);

    const docId = runFoundry("cast", ["keccak", "Q3_Financials_Confidential.md"]);
    const cipherHash = runFoundry("cast", ["keccak", "qoreseal:epoch1:ciphertext"]);
    const aadHash = runFoundry("cast", ["keccak", "qoredataroom|epoch=1"]);
    runFoundry("cast", [
      "send",
      registryAddr,
      "anchorDocument(bytes32,uint32,bytes32,bytes32,bytes32,string)",
      roomId,
      "1",
      docId,
      cipherHash,
      aadHash,
      "Q3_Financials_Confidential.md",
      "--rpc-url",
      rpcUrl,
      "--private-key",
      ANVIL_PK_0,
    ]);
    console.log(`[4/6] Created PQC-gated room (${roomId.slice(0, 14)}…), enrolled Bidder A & Bidder B, and anchored Epoch 1 document`);

    const newEpochRoot = runFoundry("cast", ["keccak", "EPOCH-2-MERKLE-ROOT-NO-BIDDER-B"]);
    const evictDigest = runFoundry("cast", [
      "call",
      registryAddr,
      "getEvictionDigest(bytes32,address,uint32,bytes32,uint256)(bytes32)",
      roomId,
      BIDDER_B,
      "2",
      newEpochRoot,
      "0",
      "--rpc-url",
      rpcUrl,
    ]);

    const encodedPair = runFoundry("cast", [
      "abi-encode",
      "f(bytes,bytes)",
      ownerPqPubkey,
      evictDigest,
    ]);
    const pairHash = runFoundry("cast", ["keccak", encodedPair]);
    const prefixHex = Buffer.from("ML-DSA-87-SIG:").toString("hex");
    const mockMlDsaSig = `0x${prefixHex}${pairHash.slice(2)}`;

    const evictOut = runFoundry("cast", [
      "send",
      registryAddr,
      "evictMemberWithPqcProof(bytes32,address,uint32,bytes32,uint256,bytes)",
      roomId,
      BIDDER_B,
      "2",
      newEpochRoot,
      "0",
      mockMlDsaSig,
      "--rpc-url",
      rpcUrl,
      "--private-key",
      ANVIL_PK_0,
      "--json",
    ]);
    const evictTxHash = JSON.parse(evictOut).transactionHash;
    console.log(`[5/6] Broadcast ML-DSA-87 evictMemberWithPqcProof on-chain (tx ${evictTxHash})`);

    const bidderBRec = runFoundry("cast", [
      "call",
      registryAddr,
      "getMember(bytes32,address)((uint8,bytes32,uint32,uint32,bool))",
      roomId,
      BIDDER_B,
      "--rpc-url",
      rpcUrl,
    ]);
    const roomNonce = runFoundry("cast", [
      "call",
      registryAddr,
      "roomPqcNonce(bytes32)(uint256)",
      roomId,
      "--rpc-url",
      rpcUrl,
    ]);
    assert.equal(roomNonce, "1");
    assert.match(bidderBRec, /2,\s*false\s*\)?$/);
    console.log(`[6/6] Verified Epoch 2 rotation -> roomPqcNonce=${roomNonce}, evicted Bidder B=${bidderBRec}`);
    console.log("PASS: DataRoomRegistry.sol local Diana EVM (9800) deployment + ML-DSA-87 eviction succeeded.");
  } finally {
    anvil.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
