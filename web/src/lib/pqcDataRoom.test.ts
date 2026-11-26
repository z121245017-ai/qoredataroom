import { describe, expect, it } from "vitest";
import {
  CRYPTO_SPECS,
  SAMPLE_DOC_EPOCH_1,
  SAMPLE_DOC_EPOCH_2,
  auditDocumentDecryption,
  evictParticipantWithMlDsaProof,
  initializeDataRoom,
  runAadTamperAttack,
  runRecipientCardTamperAttack,
  sealRoomDocument,
} from "./pqcDataRoom";
import { buildDataRoomEvmWindowPreview, buildKemRegistrationPreview, DIANA_CONFIG } from "./diana";
import { pqVerify } from "@qorechain/qoresign";
import { hexToBytes } from "viem";

describe("QoreDataRoom — Real Post-Quantum Cryptography (NO Mocks)", () => {
  it("generates authentic NIST FIPS 203 ML-KEM-1024 + X25519 & FIPS 204 ML-DSA-87 identities and signed Recipient Cards", () => {
    const room = initializeDataRoom();
    expect(room.currentEpoch).toBe(1);
    expect(room.participantOrder).toEqual(["owner", "bidder-a", "bidder-b", "auditor"]);

    for (const id of room.participantOrder) {
      const p = room.participants[id];
      expect(p.qorAddress.startsWith("qor1")).toBe(true);
      expect(p.evmAddress.startsWith("0x")).toBe(true);
      expect(p.sealKeys.mlkemPublicKey.length).toBe(CRYPTO_SPECS.mlKemPublicKeyBytes); // 1568 B
      expect(p.sealKeys.mlkemSecretKey.length).toBe(CRYPTO_SPECS.mlKemSecretKeyBytes); // 3168 B
      expect(p.sealKeys.x25519PublicKey.length).toBe(CRYPTO_SPECS.x25519KeyBytes); // 32 B
      expect(p.pqKey.publicKey.length).toBe(CRYPTO_SPECS.mlDsaPublicKeyBytes); // 2592 B
      expect(p.pqKey.secretKey.length).toBe(CRYPTO_SPECS.mlDsaSecretKeyBytes); // 4896 B
      expect(p.recipientCard.signature.signatureType).toBe("ml-dsa-87-hybrid");
      expect(p.cardVerified).toBe(true);
      expect(p.knownEpochKeys).toHaveLength(1);
      expect(p.knownEpochKeys[0].epoch).toBe(1n);
    }

    // Tampering with 1 byte of X25519 public key in Recipient Card MUST fail with CARD_INVALID
    const cardAttack = runRecipientCardTamperAttack(room);
    expect(cardAttack.blocked).toBe(true);
    expect(cardAttack.errorCode).toBe("CARD_INVALID");
  });

  it("seals Epoch 1 M&A financials with ML-KEM-1024 + X25519 + AAD, lets all 4 roles decrypt, and blocks AAD tampering", async () => {
    const room = initializeDataRoom();
    const doc1 = await sealRoomDocument(room, SAMPLE_DOC_EPOCH_1.label, SAMPLE_DOC_EPOCH_1.content);

    expect(doc1.epoch).toBe(1);
    expect(doc1.envelopeText.startsWith("qoreseal:")).toBe(true);
    expect(doc1.parsedEnvelope.mode).toBe("hybrid");
    expect(doc1.parsedEnvelope.entries).toHaveLength(4);
    expect(doc1.parsedEnvelope.entries[0].mlkemCiphertext.length).toBe(1568);
    expect(doc1.parsedEnvelope.entries[0].x25519Ciphertext?.length).toBe(32);

    // All 4 participants decrypt Epoch 1 cleanly
    for (const id of room.participantOrder) {
      const audit = auditDocumentDecryption(room, doc1, id);
      expect(audit.batchAllowed).toBe(true);
      expect(audit.envelopeAllowed).toBe(true);
      expect(audit.plaintextMatches).toBe(true);
      expect(audit.decryptedPreview).toBe(SAMPLE_DOC_EPOCH_1.content);
      expect(audit.errorCode).toBeNull();
    }

    // Mutated AAD MUST fail with DECRYPTION_FAILED
    const aadAttack = runAadTamperAttack(room, doc1);
    expect(aadAttack.blocked).toBe(true);
    expect(aadAttack.errorCode).toBe("DECRYPTION_FAILED");
  });

  it("evicts Bidder B with a real 4627-byte ML-DSA-87 proof, rotates to Epoch 2, and blocks Bidder B with UNKNOWN_EPOCH", async () => {
    const room = initializeDataRoom();
    const doc1 = await sealRoomDocument(room, SAMPLE_DOC_EPOCH_1.label, SAMPLE_DOC_EPOCH_1.content);

    // Evict Bidder B with ML-DSA-87 proof over exact Solidity QOREDATAROOM_EVICT_V1 digest
    const proof = evictParticipantWithMlDsaProof(room, "bidder-b", DIANA_CONFIG.defaultRegistryAddress);
    expect(proof.previousEpoch).toBe(1);
    expect(proof.nextEpoch).toBe(2);
    expect(proof.mlDsaSignatureBytes).toBe(4627);
    expect(proof.mlDsaPubkeyBytes).toBe(2592);
    expect(proof.verifiedLocally).toBe(true);
    expect(proof.bidderBEnvelopeErrorCode).toBe("NOT_A_RECIPIENT");
    expect(room.currentEpoch).toBe(2);

    // Tampered digest MUST NOT verify under Deal Owner's ML-DSA-87 key
    const tamperedDigest = hexToBytes(proof.evictionDigest);
    tamperedDigest[0] ^= 0xff;
    expect(pqVerify(room.participants.owner.pqKey.publicKey, tamperedDigest, proof.mlDsaSignature)).toBe(false);

    // Wrong participant's ML-DSA-87 public key MUST NOT verify the owner's eviction proof
    expect(
      pqVerify(
        room.participants["bidder-a"].pqKey.publicKey,
        hexToBytes(proof.evictionDigest),
        proof.mlDsaSignature
      )
    ).toBe(false);

    // Seal Epoch 2 Final Valuation Model
    const doc2 = await sealRoomDocument(room, SAMPLE_DOC_EPOCH_2.label, SAMPLE_DOC_EPOCH_2.content);
    expect(doc2.epoch).toBe(2);
    expect(doc2.parsedEnvelope.entries).toHaveLength(3);

    // Deal Owner, Bidder A, and Independent Auditor decrypt Epoch 2 cleanly
    for (const allowedId of ["owner", "bidder-a", "auditor"] as const) {
      const audit = auditDocumentDecryption(room, doc2, allowedId);
      expect(audit.batchAllowed).toBe(true);
      expect(audit.envelopeAllowed).toBe(true);
      expect(audit.decryptedPreview).toBe(SAMPLE_DOC_EPOCH_2.content);
    }

    // Evicted Bidder B still reads Epoch 1 (prior lawful access)
    const bidderBEpoch1 = auditDocumentDecryption(room, doc1, "bidder-b");
    expect(bidderBEpoch1.batchAllowed).toBe(true);
    expect(bidderBEpoch1.envelopeAllowed).toBe(true);
    expect(bidderBEpoch1.decryptedPreview).toBe(SAMPLE_DOC_EPOCH_1.content);

    // Evicted Bidder B is cryptographically blocked on Epoch 2 with UNKNOWN_EPOCH!
    const bidderBEpoch2 = auditDocumentDecryption(room, doc2, "bidder-b");
    expect(bidderBEpoch2.batchAllowed).toBe(false);
    expect(bidderBEpoch2.envelopeAllowed).toBe(false);
    expect(bidderBEpoch2.errorCode).toBe("UNKNOWN_EPOCH");
    expect(bidderBEpoch2.decryptedPreview).toBeNull();
  });

  it("composes valid @qorechain/evm scoped EVM Window & @qorechain/qoreseal MsgRegisterKEMKey payloads", () => {
    const room = initializeDataRoom();
    const evmWindow = buildDataRoomEvmWindowPreview(
      DIANA_CONFIG.defaultDemoQorAddress,
      DIANA_CONFIG.defaultRegistryAddress,
      600,
      20
    );
    expect(evmWindow.message.typeUrl).toBe("/qorechain.pqc.v1.MsgOpenEVMWindow");
    expect(evmWindow.message.value.sender).toBe(DIANA_CONFIG.defaultDemoQorAddress);
    expect(evmWindow.message.value.blocks).toBe("600");
    expect(evmWindow.message.value.maxTxs).toBe("20");
    expect(evmWindow.message.value.allowedTargets).toEqual([DIANA_CONFIG.defaultRegistryAddress.toLowerCase()]);
    expect(BigInt(evmWindow.recommendedMaxValueUqor)).toBeGreaterThan(0n);

    const kemMsg = buildKemRegistrationPreview(
      DIANA_CONFIG.defaultDemoQorAddress,
      room.participants.owner.sealKeys.mlkemPublicKey
    );
    expect(kemMsg.typeUrl).toBe("/qorechain.pqc.v1.MsgRegisterKEMKey");
    expect(kemMsg.mlkemKeyBytes).toBe(1568);
    expect(kemMsg.valueBytes).toBeGreaterThan(1568);
  });
});
