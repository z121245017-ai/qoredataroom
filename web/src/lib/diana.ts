import {
  evmWindowCost,
  evmWindowStatus,
  openEvmWindowMessage,
  toEvmAddress,
  toQorAddress,
  type EvmWindow,
  type OpenEvmWindowMessage,
} from "@qorechain/evm";
import { buildRegisterKemKeyMessage, toHex } from "@qorechain/qoreseal";
import { decodeAbiParameters, encodeFunctionData, parseAbi } from "viem";

export const DIANA_CONFIG = {
  cosmosChainId: "qorechain-diana",
  evmChainId: 9800,
  evmChainIdHex: "0x2648",
  cosmosRpcUrl: "https://rpc-testnet.qore.host",
  cosmosLcdUrl: "https://api-testnet.qore.host",
  evmRpcUrl: "https://evm-testnet.qore.host",
  explorerUrl: "https://explore.qore.network",
  pqcVerifyPrecompile: "0x0000000000000000000000000000000000000a01" as `0x${string}`,
  pqcKeyStatusPrecompile: "0x0000000000000000000000000000000000000a02" as `0x${string}`,
  defaultDemoQorAddress: "qor1jmd3fgvvz344uhma8r4nat4pglvpgsfng53d4w",
  defaultDemoEvmAddress: "0x96db14a18c146b5e5f7d38eb3eaea147d8144133" as `0x${string}`,
  /** Deterministic all-lowercase placeholder until live Diana deployment address is pasted in */
  defaultRegistryAddress: "0x000000000000000000000000000000000000da7a" as `0x${string}`,
} as const;

/**
 * Exact 4-tuple ABI verified directly against live Diana EVM precompile 0x...0a02
 * (160-byte return payload with bytes offset 0x80 and word 3 = bool possessionProven).
 * Note: @qorechain/evm@0.14.0's bundled IQORE_PQC_ABI declares only 3 outputs, so
 * we explicitly decode all 4 outputs here to preserve `possessionProven`.
 */
export const LIVE_PQC_PRECOMPILE_ABI = parseAbi([
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
  "function pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool valid)",
]);

export interface LivePqcPrecompileStatus {
  registered: boolean;
  algorithmId: number;
  pubkeyBytes: number;
  possessionProven: boolean;
  qualifiedMlDsa87: boolean;
  rawReturnBytes: number;
}

export interface LiveKemLookupResult {
  qorAddress: string;
  evmAddress: `0x${string}`;
  kemFound: boolean;
  kemAlgorithmId: number | null;
  kemPublicKeyHex: string | null;
  kemRegisteredAt: string | null;
  pqcAccountFound: boolean;
  evmWindow: EvmWindow | null;
  precompileStatus: LivePqcPrecompileStatus | null;
  source: "proxy" | "direct";
  checkedAt: string;
  error?: string;
}

export interface DianaNetworkSnapshot {
  connected: boolean;
  cosmosNetwork: string;
  cosmosBlockHeight: string;
  cosmosBlockTime: string;
  evmChainIdHex: string;
  evmChainId: number;
  evmBlockNumber: number;
  precompile0a01Live: boolean;
  precompile0a02Live: boolean;
  precompile0a02TupleWords: number;
  checkedAt: string;
  error?: string;
}

export interface QoreXConnectionState {
  installed: boolean;
  eip6963Detected: boolean;
  nativeAvailable: boolean;
  connected: boolean;
  qorAddress: string | null;
  evmAddress: string | null;
  providerName: string;
  note: string;
}

export interface EvmWindowPreview {
  message: OpenEvmWindowMessage;
  estimatedTxCostUqor: string;
  recommendedMaxValueUqor: string;
  allowedTargets: string[];
  blocks: number;
  maxTxs: number;
}

export interface KemRegisterPreview {
  typeUrl: string;
  sender: string;
  algorithmId: number;
  mlkemKeyBytes: number;
  valueHexPreview: string;
  valueBytes: number;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface Eip6963AnnounceEvent extends Event {
  detail: {
    info: Eip6963ProviderInfo;
    provider: Eip1193Provider;
  };
}

interface QoreXNativeProvider {
  enable?: (chainId: string) => Promise<void>;
  getKey?: (chainId: string) => Promise<{ bech32Address?: string; address?: string }>;
  signAndBroadcast?: (chainId: string, messages: unknown[], memo?: string) => Promise<unknown>;
  signArbitrary?: (chainId: string, signer: string, data: string | Uint8Array) => Promise<unknown>;
}

declare global {
  interface Window {
    qorex?: {
      native?: QoreXNativeProvider;
      enable?: (chainId: string) => Promise<void>;
      getKey?: (chainId: string) => Promise<{ bech32Address?: string }>;
      ethereum?: Eip1193Provider;
    };
  }
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from ${url}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function resolveBase(proxyPrefix: string, directUrl: string): { url: string; mode: "proxy" | "direct" } {
  if (typeof window !== "undefined" && (window.location.protocol === "http:" || window.location.protocol === "https:")) {
    const host = window.location.hostname;
    if (host === "127.0.0.1" || host === "localhost") {
      return { url: proxyPrefix, mode: "proxy" };
    }
  }
  return { url: directUrl, mode: "direct" };
}

async function evmRpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const primary = resolveBase("/evm-rpc", DIANA_CONFIG.evmRpcUrl);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
  try {
    const res = await fetchJsonWithTimeout<{ result?: T; error?: { message: string } }>(primary.url, init);
    if (res.error) throw new Error(res.error.message);
    if (res.result === undefined) throw new Error(`Empty JSON-RPC result for ${method}`);
    return res.result;
  } catch (err) {
    if (primary.mode === "proxy") {
      const res = await fetchJsonWithTimeout<{ result?: T; error?: { message: string } }>(
        DIANA_CONFIG.evmRpcUrl,
        init
      );
      if (res.error) throw new Error(res.error.message);
      if (res.result === undefined) throw new Error(`Empty JSON-RPC result for ${method}`);
      return res.result;
    }
    throw err;
  }
}

export async function queryPrecompileKeyStatus(evmAddress: `0x${string}`): Promise<LivePqcPrecompileStatus> {
  const callData = encodeFunctionData({
    abi: LIVE_PQC_PRECOMPILE_ABI,
    functionName: "pqcKeyStatus",
    args: [evmAddress],
  });
  const hex = await evmRpcCall<`0x${string}`>("eth_call", [
    { to: DIANA_CONFIG.pqcKeyStatusPrecompile, data: callData },
    "latest",
  ]);
  const rawReturnBytes = hex.startsWith("0x") ? (hex.length - 2) / 2 : 0;
  if (rawReturnBytes < 128) {
    return {
      registered: false,
      algorithmId: 0,
      pubkeyBytes: 0,
      possessionProven: false,
      qualifiedMlDsa87: false,
      rawReturnBytes,
    };
  }
  const [registered, algorithmId, pubkey, possessionProven] = decodeAbiParameters(
    [
      { name: "registered", type: "bool" },
      { name: "algorithmId", type: "uint8" },
      { name: "pubkey", type: "bytes" },
      { name: "possessionProven", type: "bool" },
    ],
    hex
  );
  const pubkeyBytes = pubkey.startsWith("0x") ? (pubkey.length - 2) / 2 : 0;
  return {
    registered,
    algorithmId: Number(algorithmId),
    pubkeyBytes,
    possessionProven,
    qualifiedMlDsa87: registered && possessionProven && Number(algorithmId) === 1 && pubkeyBytes > 0,
    rawReturnBytes,
  };
}

export async function probePrecompile0a01(): Promise<boolean> {
  const callData = encodeFunctionData({
    abi: LIVE_PQC_PRECOMPILE_ABI,
    functionName: "pqcVerify",
    args: ["0x01", "0x02", "0x03"],
  });
  const hex = await evmRpcCall<`0x${string}`>("eth_call", [
    { to: DIANA_CONFIG.pqcVerifyPrecompile, data: callData },
    "latest",
  ]);
  // Expects 32-byte ABI boolean (false = 0x00..00) proving precompile is deployed and responsive
  return hex.startsWith("0x") && (hex.length - 2) / 2 === 32;
}

export async function fetchDianaNetworkSnapshot(): Promise<DianaNetworkSnapshot> {
  const checkedAt = new Date().toISOString();
  try {
    const rpcBase = resolveBase("/cosmos-rpc", DIANA_CONFIG.cosmosRpcUrl);
    let cosmosStatus: {
      result?: {
        node_info?: { network?: string };
        sync_info?: { latest_block_height?: string; latest_block_time?: string };
      };
    };
    try {
      cosmosStatus = await fetchJsonWithTimeout(`${rpcBase.url}/status`);
    } catch {
      cosmosStatus = await fetchJsonWithTimeout(`${DIANA_CONFIG.cosmosRpcUrl}/status`);
    }

    const [evmChainIdHex, evmBlockHex, precompile0a01Live, demoKeyStatus] = await Promise.all([
      evmRpcCall<string>("eth_chainId", []),
      evmRpcCall<string>("eth_blockNumber", []),
      probePrecompile0a01(),
      queryPrecompileKeyStatus(DIANA_CONFIG.defaultDemoEvmAddress),
    ]);

    return {
      connected: true,
      cosmosNetwork: cosmosStatus.result?.node_info?.network ?? DIANA_CONFIG.cosmosChainId,
      cosmosBlockHeight: cosmosStatus.result?.sync_info?.latest_block_height ?? "0",
      cosmosBlockTime: cosmosStatus.result?.sync_info?.latest_block_time ?? checkedAt,
      evmChainIdHex,
      evmChainId: parseInt(evmChainIdHex, 16),
      evmBlockNumber: parseInt(evmBlockHex, 16),
      precompile0a01Live,
      precompile0a02Live: demoKeyStatus.rawReturnBytes >= 128,
      precompile0a02TupleWords: Math.floor(demoKeyStatus.rawReturnBytes / 32),
      checkedAt,
    };
  } catch (err) {
    return {
      connected: false,
      cosmosNetwork: DIANA_CONFIG.cosmosChainId,
      cosmosBlockHeight: "—",
      cosmosBlockTime: checkedAt,
      evmChainIdHex: DIANA_CONFIG.evmChainIdHex,
      evmChainId: DIANA_CONFIG.evmChainId,
      evmBlockNumber: 0,
      precompile0a01Live: false,
      precompile0a02Live: false,
      precompile0a02TupleWords: 0,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function normalizeQoreAddress(input: string): { qorAddress: string; evmAddress: `0x${string}` } {
  const trimmed = input.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const lower = trimmed.toLowerCase() as `0x${string}`;
    return { qorAddress: toQorAddress(lower), evmAddress: lower };
  }
  const evmAddress = toEvmAddress(trimmed);
  return { qorAddress: trimmed, evmAddress };
}

export async function lookupDianaAccount(addressInput: string): Promise<LiveKemLookupResult> {
  const checkedAt = new Date().toISOString();
  const { qorAddress, evmAddress } = normalizeQoreAddress(addressInput);
  const lcdBase = resolveBase("/lcd", DIANA_CONFIG.cosmosLcdUrl);

  try {
    const [kemRes, accountRes, evmWindow, precompileStatus] = await Promise.all([
      fetchJsonWithTimeout<{
        found?: boolean;
        key?: { algorithm_id?: number; public_key?: string; registered_at?: string } | null;
      }>(`${lcdBase.url}/qorechain/pqc/v1/kem/${qorAddress}`),
      fetchJsonWithTimeout<{ found?: boolean; account?: unknown | null }>(
        `${lcdBase.url}/qorechain/pqc/v1/account/${qorAddress}`
      ),
      evmWindowStatus({ rest: lcdBase.url, address: qorAddress }).catch(() => null),
      queryPrecompileKeyStatus(evmAddress).catch(() => null),
    ]);

    return {
      qorAddress,
      evmAddress,
      kemFound: Boolean(kemRes.found && kemRes.key),
      kemAlgorithmId: kemRes.key?.algorithm_id ?? null,
      kemPublicKeyHex: kemRes.key?.public_key ?? null,
      kemRegisteredAt: kemRes.key?.registered_at ?? null,
      pqcAccountFound: Boolean(accountRes.found),
      evmWindow,
      precompileStatus,
      source: lcdBase.mode,
      checkedAt,
    };
  } catch (err) {
    return {
      qorAddress,
      evmAddress,
      kemFound: false,
      kemAlgorithmId: null,
      kemPublicKeyHex: null,
      kemRegisteredAt: null,
      pqcAccountFound: false,
      evmWindow: null,
      precompileStatus: null,
      source: lcdBase.mode,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Builds a real QoreChain scoped EVM Window authorization message (`MsgOpenEVMWindow`)
 * targeting DataRoomRegistry using @qorechain/evm's production bounds checker & cost calculator.
 */
export function buildDataRoomEvmWindowPreview(
  senderQorAddress: string,
  registryAddress: string = DIANA_CONFIG.defaultRegistryAddress,
  blocks = 600,
  maxTxs = 20
): EvmWindowPreview {
  const txCostUqor = evmWindowCost({
    value: 0n,
    gas: 450_000n,
    maxFeePerGas: 30_000_000_000n, // 30 gwei ceiling
  });
  const recommendedMaxValue = txCostUqor * BigInt(maxTxs);
  const message = openEvmWindowMessage({
    sender: senderQorAddress,
    blocks,
    maxTxs,
    maxValue: recommendedMaxValue,
    allowedTargets: [registryAddress.toLowerCase()],
  });

  return {
    message,
    estimatedTxCostUqor: txCostUqor.toString(),
    recommendedMaxValueUqor: recommendedMaxValue.toString(),
    allowedTargets: message.value.allowedTargets,
    blocks,
    maxTxs,
  };
}

/**
 * Builds a real `/qorechain.pqc.v1.MsgRegisterKEMKey` protobuf Any payload
 * using @qorechain/qoreseal for native-lane QoreX `signAndBroadcast`.
 */
export function buildKemRegistrationPreview(
  senderQorAddress: string,
  mlkemPublicKey: Uint8Array
): KemRegisterPreview {
  const encoded = buildRegisterKemKeyMessage({
    sender: senderQorAddress,
    mlkemPublicKey,
  });
  const hex = toHex(encoded.value);
  return {
    typeUrl: encoded.typeUrl,
    sender: senderQorAddress,
    algorithmId: 2, // ML-KEM-1024 on QoreChain
    mlkemKeyBytes: mlkemPublicKey.length,
    valueHexPreview: `${hex.slice(0, 64)}…${hex.slice(-24)}`,
    valueBytes: encoded.value.length,
  };
}

/**
 * Discovers QoreX via EIP-6963 (`rdns === "network.qore.qorex"`) and `window.qorex.native`
 * directly — deliberately avoiding `@qorechain/react` `useTx`.
 */
export async function detectAndConnectQoreX(): Promise<QoreXConnectionState> {
  if (typeof window === "undefined") {
    return {
      installed: false,
      eip6963Detected: false,
      nativeAvailable: false,
      connected: false,
      qorAddress: null,
      evmAddress: null,
      providerName: "Unavailable (SSR)",
      note: "Run in browser with QoreX installed for live signing.",
    };
  }

  let qorexEip6963: { info: Eip6963ProviderInfo; provider: Eip1193Provider } | null = null;

  await new Promise<void>((resolve) => {
    const handler = (event: Event) => {
      const announce = event as Eip6963AnnounceEvent;
      if (announce.detail?.info?.rdns === "network.qore.qorex") {
        qorexEip6963 = announce.detail;
      }
    };
    window.addEventListener("eip6963:announceProvider", handler);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", handler);
      resolve();
    }, 180);
  });

  const nativeApi = window.qorex?.native;
  const nativeAvailable = Boolean(nativeApi?.signAndBroadcast || nativeApi?.signArbitrary);
  const eip6963Detected = Boolean(qorexEip6963);

  if (!nativeAvailable && !eip6963Detected && !window.qorex) {
    return {
      installed: false,
      eip6963Detected: false,
      nativeAvailable: false,
      connected: false,
      qorAddress: DIANA_CONFIG.defaultDemoQorAddress,
      evmAddress: DIANA_CONFIG.defaultDemoEvmAddress,
      providerName: "Read-Only Demo Mode (QoreX not detected)",
      note: "QoreX extension not detected in this browser. Loaded registered Diana Testnet read-only account for live telemetry & payload preview.",
    };
  }

  try {
    let qorAddress: string | null = null;
    let evmAddress: string | null = null;

    if (nativeApi?.enable) {
      await nativeApi.enable(DIANA_CONFIG.cosmosChainId);
    } else if (window.qorex?.enable) {
      await window.qorex.enable(DIANA_CONFIG.cosmosChainId);
    }

    if (nativeApi?.getKey) {
      const key = await nativeApi.getKey(DIANA_CONFIG.cosmosChainId);
      qorAddress = key.bech32Address ?? key.address ?? null;
    } else if (window.qorex?.getKey) {
      const key = await window.qorex.getKey(DIANA_CONFIG.cosmosChainId);
      qorAddress = key.bech32Address ?? null;
    }

    const evmProvider = (qorexEip6963 as { provider: Eip1193Provider } | null)?.provider ?? window.qorex?.ethereum;
    if (evmProvider) {
      const accounts = (await evmProvider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts?.[0]) {
        evmAddress = accounts[0].toLowerCase();
        if (!qorAddress) {
          qorAddress = toQorAddress(evmAddress);
        }
      }
    }

    if (qorAddress && !evmAddress) {
      evmAddress = toEvmAddress(qorAddress);
    }

    return {
      installed: true,
      eip6963Detected,
      nativeAvailable,
      connected: Boolean(qorAddress || evmAddress),
      qorAddress,
      evmAddress,
      providerName: eip6963Detected ? "QoreX Wallet (EIP-6963 + Native)" : "QoreX Wallet (Native)",
      note: "Connected directly via window.qorex.native + EIP-6963 (rdns: network.qore.qorex).",
    };
  } catch (err) {
    return {
      installed: true,
      eip6963Detected,
      nativeAvailable,
      connected: false,
      qorAddress: DIANA_CONFIG.defaultDemoQorAddress,
      evmAddress: DIANA_CONFIG.defaultDemoEvmAddress,
      providerName: "QoreX Wallet (Permission Declined)",
      note: err instanceof Error ? err.message : "User cancelled QoreX connection.",
    };
  }
}
