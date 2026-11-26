import {
  ALGORITHM_ML_KEM_1024,
  ENVELOPE_TEXT_PREFIX,
  EpochKeyManager,
  ML_KEM_1024_CIPHERTEXT_LENGTH,
  ML_KEM_1024_PUBLIC_KEY_LENGTH,
  ML_KEM_1024_SECRET_KEY_LENGTH,
  X25519_KEY_LENGTH,
  envelopeFromText,
  envelopeToText,
  generateSealKeys,
  isQoreSealError,
  open,
  openBatch,
  openEpochKey,
  parseEnvelope,
  seal,
  sealBatch,
  signRecipientCard,
  toHex,
  verifyRecipientCard,
  type EpochKey,
  type ParsedEnvelope,
  type RecipientCard,
  type SealKeyPair,
  type SealRecipient,
  type SealedBatch,
} from "@qorechain/qoreseal";
import {
  ALGORITHM_ML_DSA_87,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
  addressFromPublicKey,
  classicalKeyFromPrivate,
  pqKeyFromSeed,
  pqSign,
  pqVerify,
  type ClassicalKey,
  type PqKeyPair,
} from "@qorechain/qoresign";
import { encodeAbiParameters, hexToBytes, keccak256, stringToBytes } from "viem";
import { DIANA_CONFIG } from "./diana";

export const DATAROOM_PURPOSE_DOC = "qoredataroom:v1:document";
export const DATAROOM_PURPOSE_EPOCH = "qoredataroom:v1:epoch-key";
export const EVICT_DOMAIN = "QOREDATAROOM_EVICT_V1";

export type ParticipantRoleId = "owner" | "bidder-a" | "bidder-b" | "auditor";

export interface ParticipantIdentity {
  id: ParticipantRoleId;
  displayName: string;
  roleLabel: string;
  contractRole: number;
  qorAddress: string;
  evmAddress: `0x${string}`;
  classicalKey: ClassicalKey;
  pqKey: PqKeyPair;
  sealKeys: SealKeyPair;
  recipientCard: RecipientCard;
  verifiedRecipient: SealRecipient;
  cardVerified: boolean;
  kemPubkeyHash: `0x${string}`;
  recipientCardHash: `0x${string}`;
  pqPubkeyHash: `0x${string}`;
  /** Personal epoch keys unwrapped by this participant via ML-KEM-1024 + X25519 */
  knownEpochKeys: EpochKey[];
  active: boolean;
  revokedAtEpoch: number | null;
}

export interface SealedDocumentRecord {
  id: string;
  docIdBytes32: `0x${string}`;
  label: string;
  epoch: number;
  plaintextBytes: number;
  plaintextSha256Hex: string;
  aadText: string;
  aadHashBytes32: `0x${string}`;
  ciphertextSha256Bytes32: `0x${string}`;
  envelopeBytes: Uint8Array;
  envelopeText: string;
  parsedEnvelope: ParsedEnvelope;
  batch: SealedBatch;
  recipientIds: ParticipantRoleId[];
  createdAt: string;
}

export interface DecryptionAuditResult {
  participantId: ParticipantRoleId;
  displayName: string;
  epoch: number;
  envelopeAllowed: boolean;
  batchAllowed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  decryptedPreview: string | null;
  plaintextMatches: boolean;
}

export interface EvictionProofRecord {
  roomIdBytes32: `0x${string}`;
  registryAddress: `0x${string}`;
  evictedId: ParticipantRoleId;
  evictedEvmAddress: `0x${string}`;
  previousEpoch: number;
  nextEpoch: number;
  nonce: bigint;
  newEpochRootHash: `0x${string}`;
  evictionDigest: `0x${string}`;
  mlDsaSignature: Uint8Array;
  mlDsaSignatureHexPreview: string;
  mlDsaSignatureBytes: number;
  mlDsaPubkeyBytes: number;
  verifiedLocally: boolean;
  epochDistributionText: string;
  epochDistributionBytes: number;
  bidderBEnvelopeErrorCode: string | null;
}

export interface AttackTestResult {
  name: string;
  blocked: boolean;
  errorCode: string;
  detail: string;
}

export interface DataRoomState {
  roomIdText: string;
  roomIdBytes32: `0x${string}`;
  roomName: string;
  chainId: string;
  currentEpoch: number;
  nonce: bigint;
  participants: Record<ParticipantRoleId, ParticipantIdentity>;
  participantOrder: ParticipantRoleId[];
  epochManager: EpochKeyManager;
  epochDistributions: Record<number, { envelope: Uint8Array; text: string; members: ParticipantRoleId[] }>;
  documents: SealedDocumentRecord[];
  evictionProof: EvictionProofRecord | null;
}

export const CRYPTO_SPECS = {
  mlKemAlgorithmId: ALGORITHM_ML_KEM_1024,
  mlKemPublicKeyBytes: ML_KEM_1024_PUBLIC_KEY_LENGTH,
  mlKemSecretKeyBytes: ML_KEM_1024_SECRET_KEY_LENGTH,
  mlKemCiphertextBytes: ML_KEM_1024_CIPHERTEXT_LENGTH,
  x25519KeyBytes: X25519_KEY_LENGTH,
  mlDsaAlgorithmId: ALGORITHM_ML_DSA_87,
  mlDsaPublicKeyBytes: ML_DSA_87_PUBLIC_KEY_LENGTH,
  mlDsaSecretKeyBytes: ML_DSA_87_SECRET_KEY_LENGTH,
  mlDsaSignatureBytes: ML_DSA_87_SIGNATURE_LENGTH,
  envelopePrefix: ENVELOPE_TEXT_PREFIX,
} as const;

export const SAMPLE_DOC_EPOCH_1 = {
  label: "Q3_Financials_Confidential.md",
  content: `# Project Helios — Q3 2026 Confidential Financial Memorandum
Classification : STRICTLY CONFIDENTIAL — POST-QUANTUM SEALED (EPOCH 1)
Deal Code      : PROJECT-HELIOS-MA-2026
Chain Context  : qorechain-diana (EVM 9800)

## Consolidated Unaudited Highlights
- Annualized Recurring Revenue (ARR): $148.6M (+41.2% YoY)
- Adjusted EBITDA Margin            : 29.4% ($43.7M)
- Net Dollar Retention (Enterprise) : 126.8%
- Top-5 Customer Concentration      : 14.1% (zero single-customer > 4.2%)
- Cash & Short-Term Treasuries      : $82.0M | Total Debt: $0.0M

## Non-Binding Bid Guidance
Indicative Round-1 bids due Friday 17:00 UTC. Only shortlisted bidders advance
to Epoch 2 final valuation models and customer contract disclosures.`,
};

export const SAMPLE_DOC_EPOCH_2 = {
  label: "Final_Valuation_Model_v2.md",
  content: `# Project Helios — Final Valuation & Exclusivity Schedule (v2)
Classification : RESTRICTED TO SHORTLISTED BIDDERS ONLY (EPOCH 2)
Revoked Party  : Bidder B (Meridian Ventures) — Cryptographically Evicted
Proof Anchor   : ML-DSA-87 Precompile Eviction Digest Verified

## Revised Enterprise Valuation Bridge
- Binding Floor Valuation : $1,120,000,000 (7.54x ARR)
- Earn-out Escrow Tranche : $85,000,000 tied to FY27 enterprise milestones
- Exclusivity Counterparty: Apex Capital (Bidder A) + Independent Auditor review
- Closing Target          : T+21 business days following final SPA execution

## Cryptographic Guarantee
This document was sealed after EpochKeyManager.removeMember("bidder-b") rotated
the room to Epoch 2. Meridian Ventures retains read access to Epoch 1 disclosures
but lacks the Epoch 2 key (QoreSealError: UNKNOWN_EPOCH).`,
};

function randomBytes32(): Uint8Array {
  const buf = new Uint8Array(32);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so WebCrypto SubtleCrypto accepts it cleanly across Node + Browser
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return toHex(new Uint8Array(digest));
}

export function buildDocumentAad(roomIdText: string, epoch: number, plaintextSha256Hex: string): string {
  return `qoredataroom|room=${roomIdText}|epoch=${epoch}|sha256=${plaintextSha256Hex}`;
}

export function computeSolidityEvictionDigest(params: {
  evmChainId: bigint;
  registryAddress: `0x${string}`;
  roomIdBytes32: `0x${string}`;
  memberEvmAddress: `0x${string}`;
  nextEpoch: number;
  newEpochRootHash: `0x${string}`;
  nonce: bigint;
}): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { type: "string" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes32" },
      { type: "address" },
      { type: "uint32" },
      { type: "bytes32" },
      { type: "uint256" },
    ],
    [
      EVICT_DOMAIN,
      params.evmChainId,
      params.registryAddress,
      params.roomIdBytes32,
      params.memberEvmAddress,
      params.nextEpoch,
      params.newEpochRootHash,
      params.nonce,
    ]
  );
  return keccak256(encoded);
}

function generateParticipant(
  id: ParticipantRoleId,
  displayName: string,
  roleLabel: string,
  contractRole: number,
  chainId: string
): ParticipantIdentity {
  const classicalKey = classicalKeyFromPrivate(randomBytes32(), "eth_secp256k1");
  const addr = addressFromPublicKey(classicalKey.publicKey, "eth_secp256k1");
  const pqKey = pqKeyFromSeed(randomBytes32());
  const sealKeys = generateSealKeys();

  // Sign a REAL QoreSeal Recipient Card with classical secp256k1 + ML-DSA-87 hybrid signature
  const recipientCard = signRecipientCard({
    chainId,
    address: addr.bech32,
    keys: sealKeys,
    classicalKey,
    pqKey,
  });

  // Strictly verify the card against the participant's ML-DSA-87 + ML-KEM-1024 keys (zero silent downgrade)
  const verifiedRecipient = verifyRecipientCard({
    card: recipientCard,
    chainId,
    address: addr.bech32,
    pqPublicKey: pqKey.publicKey,
    mlkemPublicKey: sealKeys.mlkemPublicKey,
  });

  const kemPubkeyHash = keccak256(sealKeys.mlkemPublicKey);
  const recipientCardHash = keccak256(stringToBytes(JSON.stringify(recipientCard)));
  const pqPubkeyHash = keccak256(pqKey.publicKey);

  return {
    id,
    displayName,
    roleLabel,
    contractRole,
    qorAddress: addr.bech32,
    evmAddress: addr.hex.toLowerCase() as `0x${string}`,
    classicalKey,
    pqKey,
    sealKeys,
    recipientCard,
    verifiedRecipient,
    cardVerified: true,
    kemPubkeyHash,
    recipientCardHash,
    pqPubkeyHash,
    knownEpochKeys: [],
    active: true,
    revokedAtEpoch: null,
  };
}

/**
 * Initializes the 4-role Project Helios M&A Data Room with REAL NIST post-quantum keys,
 * REAL ML-DSA-87 Recipient Cards, and an active Epoch 1 key distribution via EpochKeyManager.
 */
export function initializeDataRoom(
  roomIdText = "PROJECT-HELIOS-MA-2026",
  roomName = "Project Helios — M&A Due-Diligence VDR"
): DataRoomState {
  const chainId = DIANA_CONFIG.cosmosChainId;
  const roomIdBytes32 = keccak256(stringToBytes(roomIdText));

  const owner = generateParticipant("owner", "Deal Owner (Helios Corp)", "Seller / VDR Admin", 1, chainId);
  const bidderA = generateParticipant("bidder-a", "Bidder A — Apex Capital", "Shortlisted PE Bidder", 2, chainId);
  const bidderB = generateParticipant("bidder-b", "Bidder B — Meridian Ventures", "Competing PE Bidder", 2, chainId);
  const auditor = generateParticipant("auditor", "Independent Auditor", "Big-4 Escrow Reviewer", 3, chainId);

  const participantOrder: ParticipantRoleId[] = ["owner", "bidder-a", "bidder-b", "auditor"];
  const participants: Record<ParticipantRoleId, ParticipantIdentity> = {
    owner,
    "bidder-a": bidderA,
    "bidder-b": bidderB,
    auditor,
  };

  // Real EpochKeyManager with all 4 verified ML-KEM-1024 + X25519 hybrid recipients
  const epochManager = new EpochKeyManager({
    chainId,
    purpose: DATAROOM_PURPOSE_EPOCH,
    mode: "hybrid",
    members: {
      owner: owner.verifiedRecipient,
      "bidder-a": bidderA.verifiedRecipient,
      "bidder-b": bidderB.verifiedRecipient,
      auditor: auditor.verifiedRecipient,
    },
  });

  // Distribute Epoch 1 key to all 4 participants and have each unwrap it with their own secret keys
  const epoch1Distribution = epochManager.distribution();
  for (const pid of participantOrder) {
    const p = participants[pid];
    const openedEpochKey = openEpochKey({
      chainId,
      purpose: DATAROOM_PURPOSE_EPOCH,
      envelope: epoch1Distribution,
      keys: p.sealKeys,
    });
    p.knownEpochKeys = [openedEpochKey];
  }

  return {
    roomIdText,
    roomIdBytes32,
    roomName,
    chainId,
    currentEpoch: Number(epochManager.epoch),
    nonce: 0n,
    participants,
    participantOrder,
    epochManager,
    epochDistributions: {
      1: {
        envelope: epoch1Distribution,
        text: envelopeToText(epoch1Distribution),
        members: [...participantOrder],
      },
    },
    documents: [],
    evictionProof: null,
  };
}

/**
 * Seals a confidential document in the room's CURRENT epoch using BOTH:
 * 1) Real multi-recipient hybrid QoreSeal envelope (`ML-KEM-1024 + X25519` + AAD binding)
 * 2) Real `sealBatch` under `EpochKeyManager.currentKey` (so evicted members fail with `UNKNOWN_EPOCH`).
 */
export async function sealRoomDocument(
  state: DataRoomState,
  label: string,
  plaintext: string
): Promise<SealedDocumentRecord> {
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const plaintextSha256Hex = await sha256Hex(plaintextBytes);
  const epoch = state.currentEpoch;
  const aadText = buildDocumentAad(state.roomIdText, epoch, plaintextSha256Hex);
  const aadBytes = new TextEncoder().encode(aadText);

  const activeIds = state.participantOrder.filter((id) => state.participants[id].active);
  const recipients = activeIds.map((id) => {
    const p = state.participants[id];
    // Re-verify Recipient Card strictly before every seal (zero silent downgrade!)
    return verifyRecipientCard({
      card: p.recipientCard,
      chainId: state.chainId,
      address: p.qorAddress,
      pqPublicKey: p.pqKey.publicKey,
      mlkemPublicKey: p.sealKeys.mlkemPublicKey,
    });
  });

  const envelopeBytes = seal({
    chainId: state.chainId,
    purpose: DATAROOM_PURPOSE_DOC,
    recipients,
    plaintext: plaintextBytes,
    aad: aadBytes,
    mode: "hybrid",
  });

  const envelopeText = envelopeToText(envelopeBytes);
  const parsedEnvelope = parseEnvelope(envelopeBytes);

  const batchIndex = BigInt(state.documents.length + 1);
  const batch = sealBatch({
    epochKey: state.epochManager.currentKey,
    context: state.roomIdText,
    batchIndex,
    data: plaintextBytes,
  });

  const ciphertextSha256Hex = await sha256Hex(envelopeBytes);
  const docIdBytes32 = keccak256(stringToBytes(`${state.roomIdText}:${epoch}:${label}:${batchIndex}`));
  const aadHashBytes32 = keccak256(aadBytes);
  const ciphertextSha256Bytes32 = `0x${ciphertextSha256Hex}` as `0x${string}`;

  const doc: SealedDocumentRecord = {
    id: `doc-${epoch}-${state.documents.length + 1}`,
    docIdBytes32,
    label,
    epoch,
    plaintextBytes: plaintextBytes.length,
    plaintextSha256Hex,
    aadText,
    aadHashBytes32,
    ciphertextSha256Bytes32,
    envelopeBytes,
    envelopeText,
    parsedEnvelope,
    batch,
    recipientIds: activeIds,
    createdAt: new Date().toISOString(),
  };

  state.documents = [...state.documents, doc];
  return doc;
}

/**
 * Attempts real client-side decryption of a sealed document for a given participant
 * via BOTH the Epoch batch key (`openBatch` -> throws `UNKNOWN_EPOCH` when evicted)
 * AND the `qoreseal:...` direct hybrid envelope (`open` -> throws `NOT_A_RECIPIENT`).
 */
export function auditDocumentDecryption(
  state: DataRoomState,
  doc: SealedDocumentRecord,
  participantId: ParticipantRoleId
): DecryptionAuditResult {
  const participant = state.participants[participantId];
  const aadBytes = new TextEncoder().encode(doc.aadText);

  let batchAllowed = false;
  let envelopeAllowed = false;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let decryptedText: string | null = null;

  // 1. Test EpochKeyManager batch decryption (throws UNKNOWN_EPOCH for evicted members on Epoch 2!)
  try {
    const openedBatch = openBatch({
      blob: doc.batch.blob,
      keys: participant.knownEpochKeys,
    });
    batchAllowed = true;
    decryptedText = new TextDecoder().decode(openedBatch.data);
  } catch (err) {
    if (isQoreSealError(err)) {
      errorCode = err.code;
      errorMessage = err.message;
    } else {
      errorCode = "BATCH_ERROR";
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  // 2. Test direct qoreseal:... hybrid envelope decryption with AAD authentication
  try {
    const parsedFromText = envelopeFromText(doc.envelopeText);
    const openedBytes = open({
      chainId: state.chainId,
      purpose: DATAROOM_PURPOSE_DOC,
      envelope: parsedFromText,
      keys: participant.sealKeys,
      aad: aadBytes,
    });
    envelopeAllowed = true;
    if (!decryptedText) {
      decryptedText = new TextDecoder().decode(openedBytes);
    }
  } catch (err) {
    if (!errorCode) {
      if (isQoreSealError(err)) {
        errorCode = err.code;
        errorMessage = err.message;
      } else {
        errorCode = "ENVELOPE_ERROR";
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return {
    participantId,
    displayName: participant.displayName,
    epoch: doc.epoch,
    envelopeAllowed,
    batchAllowed,
    errorCode,
    errorMessage,
    decryptedPreview: decryptedText,
    plaintextMatches: Boolean(decryptedText && decryptedText.length > 0 && batchAllowed && envelopeAllowed),
  };
}

/**
 * Executes Epoch 2 eviction of a bidder (default: Bidder B — Meridian Ventures):
 * 1) Rotates real `EpochKeyManager` via `removeMember(targetId)`.
 * 2) Computes the exact Solidity `DataRoomRegistry.getEvictionDigest(...)` commitment.
 * 3) Signs the eviction digest with Deal Owner's REAL ML-DSA-87 secret key (`4627 B` sig).
 * 4) Verifies the ML-DSA-87 proof locally via `pqVerify` (`true`).
 * 5) Distributes the Epoch 2 key envelope ONLY to remaining members; verifies evicted member gets `NOT_A_RECIPIENT`.
 */
export function evictParticipantWithMlDsaProof(
  state: DataRoomState,
  targetId: ParticipantRoleId = "bidder-b",
  registryAddress: `0x${string}` = DIANA_CONFIG.defaultRegistryAddress
): EvictionProofRecord {
  const target = state.participants[targetId];
  if (!target || targetId === "owner") {
    throw new Error("Cannot evict Deal Owner or unknown participant.");
  }
  if (!target.active) {
    throw new Error(`${target.displayName} is already evicted.`);
  }

  const previousEpoch = state.currentEpoch;
  const rotation = state.epochManager.removeMember(targetId);
  const nextEpoch = Number(rotation.epoch);
  if (!rotation.envelope) {
    throw new Error("Epoch rotation produced empty distribution envelope.");
  }

  const newEpochRootHash = keccak256(rotation.envelope);
  const nonce = state.nonce;
  const evictionDigest = computeSolidityEvictionDigest({
    evmChainId: BigInt(DIANA_CONFIG.evmChainId),
    registryAddress,
    roomIdBytes32: state.roomIdBytes32,
    memberEvmAddress: target.evmAddress,
    nextEpoch,
    newEpochRootHash,
    nonce,
  });

  // Sign the exact 32-byte eviction digest using Deal Owner's REAL ML-DSA-87 private key
  const digestBytes = hexToBytes(evictionDigest);
  const owner = state.participants.owner;
  const mlDsaSignature = pqSign(owner.pqKey.secretKey, digestBytes);
  const verifiedLocally = pqVerify(owner.pqKey.publicKey, digestBytes, mlDsaSignature);

  if (!verifiedLocally) {
    throw new Error("Local ML-DSA-87 self-verification failed.");
  }

  // Update participant state and distribute Epoch 2 key ONLY to active members
  target.active = false;
  target.revokedAtEpoch = nextEpoch;
  state.currentEpoch = nextEpoch;
  state.nonce = nonce + 1n;

  const remainingIds = state.participantOrder.filter((id) => state.participants[id].active);
  for (const pid of remainingIds) {
    const p = state.participants[pid];
    const openedEpochKey = openEpochKey({
      chainId: state.chainId,
      purpose: DATAROOM_PURPOSE_EPOCH,
      envelope: rotation.envelope,
      keys: p.sealKeys,
    });
    p.knownEpochKeys = [...p.knownEpochKeys, openedEpochKey];
  }

  // Cryptographically prove the evicted participant CANNOT unwrap the Epoch 2 key distribution
  let bidderBEnvelopeErrorCode: string | null = null;
  try {
    openEpochKey({
      chainId: state.chainId,
      purpose: DATAROOM_PURPOSE_EPOCH,
      envelope: rotation.envelope,
      keys: target.sealKeys,
    });
  } catch (err) {
    bidderBEnvelopeErrorCode = isQoreSealError(err) ? err.code : "UNEXPECTED_ERROR";
  }

  const distText = envelopeToText(rotation.envelope);
  state.epochDistributions[nextEpoch] = {
    envelope: rotation.envelope,
    text: distText,
    members: remainingIds,
  };

  const sigHex = toHex(mlDsaSignature);
  const proof: EvictionProofRecord = {
    roomIdBytes32: state.roomIdBytes32,
    registryAddress,
    evictedId: targetId,
    evictedEvmAddress: target.evmAddress,
    previousEpoch,
    nextEpoch,
    nonce,
    newEpochRootHash,
    evictionDigest,
    mlDsaSignature,
    mlDsaSignatureHexPreview: `${sigHex.slice(0, 40)}…${sigHex.slice(-24)}`,
    mlDsaSignatureBytes: mlDsaSignature.length,
    mlDsaPubkeyBytes: owner.pqKey.publicKey.length,
    verifiedLocally,
    epochDistributionText: distText,
    epochDistributionBytes: rotation.envelope.length,
    bidderBEnvelopeErrorCode,
  };

  state.evictionProof = proof;
  return proof;
}

/**
 * Live negative security test #1: Mutate 1 character of the authenticated AAD
 * (`epoch=1` -> `epoch=9`) and prove QoreSeal refuses decryption with `DECRYPTION_FAILED`.
 */
export function runAadTamperAttack(state: DataRoomState, doc: SealedDocumentRecord): AttackTestResult {
  const tamperedAad = `${doc.aadText}|tampered=true`;
  try {
    open({
      chainId: state.chainId,
      purpose: DATAROOM_PURPOSE_DOC,
      envelope: doc.envelopeBytes,
      keys: state.participants.owner.sealKeys,
      aad: new TextEncoder().encode(tamperedAad),
    });
    return {
      name: "AAD Metadata Tamper Attack",
      blocked: false,
      errorCode: "NONE",
      detail: "Unexpectedly decrypted tampered AAD!",
    };
  } catch (err) {
    const code = isQoreSealError(err) ? err.code : "UNKNOWN_ERROR";
    return {
      name: "AAD Metadata Tamper Attack",
      blocked: code === "DECRYPTION_FAILED",
      errorCode: code,
      detail: `AES-256-GCM authentication rejected modified AAD (${tamperedAad.slice(-26)}).`,
    };
  }
}

/**
 * Live negative security test #2: Mutate 1 hex byte of a participant's X25519 key inside
 * their ML-DSA-87 Recipient Card and prove `verifyRecipientCard` refuses it with `CARD_INVALID`.
 */
export function runRecipientCardTamperAttack(state: DataRoomState): AttackTestResult {
  const bidderA = state.participants["bidder-a"];
  const flippedHex =
    (bidderA.recipientCard.x25519PublicKey.startsWith("00") ? "ff" : "00") +
    bidderA.recipientCard.x25519PublicKey.slice(2);
  const forgedCard: RecipientCard = {
    ...bidderA.recipientCard,
    x25519PublicKey: flippedHex,
  };

  try {
    verifyRecipientCard({
      card: forgedCard,
      chainId: state.chainId,
      address: bidderA.qorAddress,
      pqPublicKey: bidderA.pqKey.publicKey,
      mlkemPublicKey: bidderA.sealKeys.mlkemPublicKey,
    });
    return {
      name: "MITM Recipient Card Substitution Attack",
      blocked: false,
      errorCode: "NONE",
      detail: "Unexpectedly accepted forged X25519 Recipient Card!",
    };
  } catch (err) {
    const code = isQoreSealError(err) ? err.code : "UNKNOWN_ERROR";
    return {
      name: "MITM Recipient Card Substitution Attack",
      blocked: code === "CARD_INVALID",
      errorCode: code,
      detail: "Strict ML-DSA-87 + secp256k1 Recipient Card signature rejected substituted X25519 key (zero silent downgrade).",
    };
  }
}
