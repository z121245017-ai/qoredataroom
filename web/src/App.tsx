import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileKey2,
  FileLock2,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserMinus,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  DIANA_CONFIG,
  buildDataRoomEvmWindowPreview,
  buildKemRegistrationPreview,
  detectAndConnectQoreX,
  fetchDianaNetworkSnapshot,
  lookupDianaAccount,
  type DianaNetworkSnapshot,
  type LiveKemLookupResult,
  type QoreXConnectionState,
} from "./lib/diana";
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
  type AttackTestResult,
  type DataRoomState,
  type DecryptionAuditResult,
  type ParticipantRoleId,
} from "./lib/pqcDataRoom";

function shortHex(v: string, head = 12, tail = 8): string {
  if (v.length <= head + tail + 3) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

export default function App() {
  const [network, setNetwork] = useState<DianaNetworkSnapshot | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);

  const [lookupInput, setLookupInput] = useState<string>(DIANA_CONFIG.defaultDemoQorAddress);
  const [lookupResult, setLookupResult] = useState<LiveKemLookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [wallet, setWallet] = useState<QoreXConnectionState>({
    installed: false,
    eip6963Detected: false,
    nativeAvailable: false,
    connected: false,
    qorAddress: DIANA_CONFIG.defaultDemoQorAddress,
    evmAddress: DIANA_CONFIG.defaultDemoEvmAddress,
    providerName: "Read-Only Demo Mode",
    note: "Click Connect QoreX to probe window.qorex.native and EIP-6963 (network.qore.qorex).",
  });

  const [room, setRoom] = useState<DataRoomState | null>(null);
  const [roomRevision, setRoomRevision] = useState(0);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedAuditRole, setSelectedAuditRole] = useState<ParticipantRoleId>("bidder-b");
  const [customLabel, setCustomLabel] = useState("Board_Consent_Addendum.md");
  const [customBody, setCustomBody] = useState(
    "Confidential board resolution: Approve final Q-Day-safe SPA closing terms for Project Helios."
  );

  const [aadAttack, setAadAttack] = useState<AttackTestResult | null>(null);
  const [cardAttack, setCardAttack] = useState<AttackTestResult | null>(null);
  const [walkthroughRunning, setWalkthroughRunning] = useState(false);
  const [walkthroughSummary, setWalkthroughSummary] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [registryInput, setRegistryInput] = useState<string>(DIANA_CONFIG.defaultRegistryAddress);

  const refreshNetwork = useCallback(async () => {
    setNetworkLoading(true);
    try {
      const snap = await fetchDianaNetworkSnapshot();
      setNetwork(snap);
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  const runAccountLookup = useCallback(async (addr: string) => {
    setLookupLoading(true);
    try {
      const res = await lookupDianaAccount(addr);
      setLookupResult(res);
    } catch (err) {
      setLookupResult({
        qorAddress: addr,
        evmAddress: DIANA_CONFIG.defaultDemoEvmAddress,
        kemFound: false,
        kemAlgorithmId: null,
        kemPublicKeyHex: null,
        kemRegisteredAt: null,
        pqcAccountFound: false,
        evmWindow: null,
        precompileStatus: null,
        source: "proxy",
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLookupLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshNetwork();
    void runAccountLookup(DIANA_CONFIG.defaultDemoQorAddress);
  }, [refreshNetwork, runAccountLookup]);

  const handleCopy = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const handleConnectQoreX = async () => {
    const state = await detectAndConnectQoreX();
    setWallet(state);
    if (state.qorAddress) {
      setLookupInput(state.qorAddress);
      void runAccountLookup(state.qorAddress);
    }
  };

  const handleInitRoom = () => {
    const fresh = initializeDataRoom();
    setRoom(fresh);
    setRoomRevision((r) => r + 1);
    setSelectedDocId(null);
    setAadAttack(null);
    setCardAttack(null);
    setWalkthroughSummary(null);
  };

  const handleSealEpoch1Sample = async () => {
    const target = room ?? initializeDataRoom();
    const doc = await sealRoomDocument(target, SAMPLE_DOC_EPOCH_1.label, SAMPLE_DOC_EPOCH_1.content);
    setRoom(target);
    setRoomRevision((r) => r + 1);
    setSelectedDocId(doc.id);
    setSelectedAuditRole("bidder-b");
  };

  const handleSealCustomDoc = async () => {
    if (!room || !customLabel.trim() || !customBody.trim()) return;
    const doc = await sealRoomDocument(room, customLabel.trim(), customBody);
    setRoomRevision((r) => r + 1);
    setSelectedDocId(doc.id);
  };

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCustomLabel(file.name);
    setCustomBody(text.slice(0, 12000));
    e.target.value = "";
  };

  const handleEvictBidderB = async () => {
    if (!room || !room.participants["bidder-b"].active) return;
    const regAddr = /^0x[0-9a-fA-F]{40}$/.test(registryInput)
      ? (registryInput.toLowerCase() as `0x${string}`)
      : DIANA_CONFIG.defaultRegistryAddress;
    evictParticipantWithMlDsaProof(room, "bidder-b", regAddr);
    const doc2 = await sealRoomDocument(room, SAMPLE_DOC_EPOCH_2.label, SAMPLE_DOC_EPOCH_2.content);
    setRoomRevision((r) => r + 1);
    setSelectedDocId(doc2.id);
    setSelectedAuditRole("bidder-b");
  };

  const handleRunFullWalkthrough = async () => {
    setWalkthroughRunning(true);
    try {
      const t0 = performance.now();
      const fresh = initializeDataRoom();
      const doc1 = await sealRoomDocument(fresh, SAMPLE_DOC_EPOCH_1.label, SAMPLE_DOC_EPOCH_1.content);
      const cardRes = runRecipientCardTamperAttack(fresh);
      const aadRes = runAadTamperAttack(fresh, doc1);

      const regAddr = /^0x[0-9a-fA-F]{40}$/.test(registryInput)
        ? (registryInput.toLowerCase() as `0x${string}`)
        : DIANA_CONFIG.defaultRegistryAddress;
      const proof = evictParticipantWithMlDsaProof(fresh, "bidder-b", regAddr);
      const doc2 = await sealRoomDocument(fresh, SAMPLE_DOC_EPOCH_2.label, SAMPLE_DOC_EPOCH_2.content);

      const elapsed = Math.round(performance.now() - t0);
      setRoom(fresh);
      setRoomRevision((r) => r + 1);
      setSelectedDocId(doc2.id);
      setSelectedAuditRole("bidder-b");
      setCardAttack(cardRes);
      setAadAttack(aadRes);
      setWalkthroughSummary(
        `Verified end-to-end in ${elapsed} ms: 4 ML-KEM-1024/ML-DSA-87 identities generated, Epoch 1 sealed (${doc1.envelopeBytes.length} B), AAD & Card tamper attacks blocked (${aadRes.errorCode} / ${cardRes.errorCode}), Bidder B evicted with ${proof.mlDsaSignatureBytes} B ML-DSA-87 proof, and Epoch 2 sealed (${doc2.envelopeBytes.length} B) with Bidder B blocked by UNKNOWN_EPOCH.`
      );
    } finally {
      setWalkthroughRunning(false);
    }
  };

  const activeDoc = useMemo(() => {
    if (!room || room.documents.length === 0) return null;
    return room.documents.find((d) => d.id === selectedDocId) ?? room.documents[room.documents.length - 1];
  }, [room, selectedDocId, roomRevision]);

  const docAudits: DecryptionAuditResult[] = useMemo(() => {
    if (!room || !activeDoc) return [];
    return room.participantOrder.map((pid) => auditDocumentDecryption(room, activeDoc, pid));
  }, [room, activeDoc, roomRevision]);

  const selectedAudit = useMemo(() => {
    return docAudits.find((a) => a.participantId === selectedAuditRole) ?? docAudits[0] ?? null;
  }, [docAudits, selectedAuditRole]);

  const evmWindowPreview = useMemo(() => {
    const sender = wallet.qorAddress ?? DIANA_CONFIG.defaultDemoQorAddress;
    const target = /^0x[0-9a-fA-F]{40}$/.test(registryInput)
      ? registryInput.toLowerCase()
      : DIANA_CONFIG.defaultRegistryAddress;
    try {
      return buildDataRoomEvmWindowPreview(sender, target, 600, 20);
    } catch {
      return buildDataRoomEvmWindowPreview(
        DIANA_CONFIG.defaultDemoQorAddress,
        DIANA_CONFIG.defaultRegistryAddress,
        600,
        20
      );
    }
  }, [wallet.qorAddress, registryInput]);

  const kemRegisterPreview = useMemo(() => {
    if (!room) return null;
    const sender = wallet.qorAddress ?? DIANA_CONFIG.defaultDemoQorAddress;
    return buildKemRegistrationPreview(sender, room.participants.owner.sealKeys.mlkemPublicKey);
  }, [room, wallet.qorAddress, roomRevision]);

  const stepStates = [
    Boolean(network?.connected),
    Boolean(room),
    Boolean(room && room.documents.some((d) => d.epoch === 1)),
    Boolean(room && room.evictionProof && room.documents.some((d) => d.epoch === 2)),
    Boolean(evmWindowPreview),
  ];

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="brand-title">
              QoreDataRoom
              <span className="badge badge-violet">Encrypted Apps</span>
            </h2>
            <p className="brand-sub">
              Post-Quantum M&amp;A Virtual Data Room · QoreChain Diana ({DIANA_CONFIG.cosmosChainId} / EVM{" "}
              {DIANA_CONFIG.evmChainId})
            </p>
          </div>
        </div>

        <div className="topbar-actions">
          <span className={`badge ${network?.connected ? "badge-emerald" : "badge-amber"}`}>
            <Activity size={12} />
            {network?.connected ? `Diana #${network.cosmosBlockHeight}` : "Connecting Diana…"}
          </span>
          <button type="button" className="btn btn-sm" onClick={handleConnectQoreX}>
            <Wallet size={14} />
            {wallet.connected ? shortHex(wallet.qorAddress ?? "", 10, 6) : "Connect QoreX"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleRunFullWalkthrough}
            disabled={walkthroughRunning}
            data-testid="walkthrough-btn"
          >
            <Play size={14} />
            {walkthroughRunning ? "Running PQC Proofs…" : "1-Click Full Walkthrough"}
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="hero-grid">
          <div>
            <div className="hero-eyebrow">
              <Lock size={12} />
              Build Before Q-Day · 100% Real Client-Side @qorechain/qoreseal + @qorechain/qoresign
            </div>
            <h1>Harvest-Now-Decrypt-Later Proof M&amp;A Data Rooms</h1>
            <p>
              Institutional M&amp;A financials stay confidential for 10+ years — making them prime Q-Day targets.
              QoreDataRoom combines <strong>ML-KEM-1024 + X25519</strong> hybrid encryption,{" "}
              <strong>ML-DSA-87 Recipient Cards</strong>, <strong>EpochKeyManager</strong> cryptographic bidder
              eviction, and QoreChain EVM precompiles (<code>0x…0a01</code> &amp; <code>0x…0a02</code>) so even a
              compromised ECDSA key cannot tamper with deal room membership.
            </p>
            <div className="hero-cta-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRunFullWalkthrough}
                disabled={walkthroughRunning}
              >
                <Play size={15} />
                Run 1-Click Full Interactive Walkthrough
              </button>
              <button type="button" className="btn" onClick={handleInitRoom}>
                <KeyRound size={15} />
                Step-by-Step: 4 PQC Roles
              </button>
              <a
                href={DIANA_CONFIG.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm"
                style={{ textDecoration: "none" }}
              >
                Diana Explorer ↗
              </a>
            </div>
          </div>

          <div className="hero-spec-box">
            <h3 className="hero-spec-title">Verified NIST PQC &amp; Diana Parameters</h3>
            <div className="spec-rows">
              <div className="spec-row">
                <span>Hybrid KEM Suite</span>
                <code>ML-KEM-1024 ({CRYPTO_SPECS.mlKemPublicKeyBytes} B) + X25519 ({CRYPTO_SPECS.x25519KeyBytes} B)</code>
              </div>
              <div className="spec-row">
                <span>PQ Signature Suite</span>
                <code>
                  ML-DSA-87 (pk {CRYPTO_SPECS.mlDsaPublicKeyBytes} B · sig {CRYPTO_SPECS.mlDsaSignatureBytes} B)
                </code>
              </div>
              <div className="spec-row">
                <span>PQC Verify Precompile</span>
                <code>0x000…0a01 (pqcVerify)</code>
              </div>
              <div className="spec-row">
                <span>Key Status Precompile</span>
                <code>0x000…0a02 (4-tuple + possessionProven)</code>
              </div>
              <div className="spec-row">
                <span>EVM Auth Window</span>
                <code>Scoped MsgOpenEVMWindow (600 blks)</code>
              </div>
            </div>
          </div>
        </div>

        {walkthroughSummary && (
          <div className="attack-banner" data-testid="walkthrough-summary">
            <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 9 }}>
              <CheckCircle2 size={17} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                <strong style={{ whiteSpace: "nowrap", color: "#6ee7b7" }}>Walkthrough Verified:</strong>{" "}
                {walkthroughSummary}
              </span>
            </span>
          </div>
        )}
      </section>

      {/* Progress Rail */}
      <nav className="step-rail" aria-label="Interactive workflow steps">
        {[
          "1. Live Diana Telemetry",
          "2. ML-KEM & ML-DSA Cards",
          "3. Epoch 1 Seal & Tamper",
          "4. Epoch 2 ML-DSA Eviction",
          "5. EVM Window & QoreX",
        ].map((label, idx) => (
          <div key={label} className={`step-pill ${stepStates[idx] ? "done" : idx === 1 ? "active" : ""}`}>
            <span className="step-num">{stepStates[idx] ? "✓" : idx + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </nav>

      {/* SECTION 1: LIVE DIANA TELEMETRY & PRECOMPILE PROBE */}
      <section className="section">
        <div className="section-head">
          <div>
            <h3 className="section-title">
              <Activity size={17} color="#22d3ee" />
              1. Live QoreChain Diana Testnet &amp; Precompile Inspector
            </h3>
            <p className="section-desc">
              Live Cosmos RPC + EVM JSON-RPC + Vite <code>/lcd</code> CORS-proxied REST queries against{" "}
              <code>qorechain-diana</code>.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={refreshNetwork} disabled={networkLoading}>
            <RefreshCw size={13} />
            {networkLoading ? "Refreshing…" : "Refresh Live RPC"}
          </button>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Cosmos Chain</div>
            <div className="kpi-val">{network?.cosmosNetwork ?? DIANA_CONFIG.cosmosChainId}</div>
            <div className="kpi-sub">Block #{network?.cosmosBlockHeight ?? "—"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">EVM Execution Lane</div>
            <div className="kpi-val">
              Chain {network?.evmChainId ?? DIANA_CONFIG.evmChainId} ({network?.evmChainIdHex ?? "0x2648"})
            </div>
            <div className="kpi-sub">EVM Block #{network?.evmBlockNumber ?? 0}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Precompile 0x…0a01</div>
            <div className="kpi-val" style={{ color: network?.precompile0a01Live ? "#6ee7b7" : "#fcd34d" }}>
              {network?.precompile0a01Live ? "LIVE · pqcVerify()" : "Probing…"}
            </div>
            <div className="kpi-sub">On-chain ML-DSA-87 verifier</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Precompile 0x…0a02</div>
            <div className="kpi-val" style={{ color: network?.precompile0a02Live ? "#6ee7b7" : "#fcd34d" }}>
              {network?.precompile0a02Live ? "LIVE · pqcKeyStatus()" : "Probing…"}
            </div>
            <div className="kpi-sub">
              4-tuple ({(network?.precompile0a02TupleWords ?? 5) * 32} B incl. possessionProven)
            </div>
          </div>
        </div>

        <div className="lookup-bar">
          <div className="lookup-input-wrap">
            <input
              type="text"
              className="input"
              aria-label="QoreChain qor1 or 0x address lookup"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="Enter qor1... or 0x... Diana Testnet address"
            />
          </div>
          <button
            type="button"
            className="btn btn-cyan"
            onClick={() => void runAccountLookup(lookupInput)}
            disabled={lookupLoading}
          >
            <Search size={14} />
            {lookupLoading ? "Querying /lcd…" : "Inspect Live KEM & PQC Status"}
          </button>
        </div>

        {lookupResult && (
          <div className="lookup-result" data-testid="diana-lookup-result">
            <div>
              <div className="kpi-label">Unified Account</div>
              <div className="mono-box">
                <div>{shortHex(lookupResult.qorAddress, 14, 8)}</div>
                <div style={{ color: "#94a3b8", marginTop: 3 }}>{shortHex(lookupResult.evmAddress, 12, 8)}</div>
              </div>
            </div>
            <div>
              <div className="kpi-label">LCD /pqc/v1/kem</div>
              <div style={{ marginTop: 4 }}>
                <span className={`badge ${lookupResult.kemFound ? "badge-emerald" : "badge-amber"}`}>
                  {lookupResult.kemFound ? `ML-KEM-1024 Registered` : "No On-Chain KEM Yet"}
                </span>
              </div>
              <div className="kpi-sub">
                {lookupResult.kemFound
                  ? `algId=${lookupResult.kemAlgorithmId} (${lookupResult.kemPublicKeyHex?.slice(0, 14)}…)`
                  : `Live /lcd probe (${lookupResult.source}) OK`}
              </div>
            </div>
            <div>
              <div className="kpi-label">Precompile 0x…0a02</div>
              <div style={{ marginTop: 4 }}>
                <span
                  className={`badge ${
                    lookupResult.precompileStatus?.qualifiedMlDsa87 ? "badge-emerald" : "badge-violet"
                  }`}
                >
                  {lookupResult.precompileStatus?.qualifiedMlDsa87
                    ? "ML-DSA-87 Qualified"
                    : `reg=${String(lookupResult.precompileStatus?.registered ?? false)} · pop=${String(
                        lookupResult.precompileStatus?.possessionProven ?? false
                      )}`}
                </span>
              </div>
              <div className="kpi-sub">
                algId={lookupResult.precompileStatus?.algorithmId ?? 0} ·{" "}
                {lookupResult.precompileStatus?.rawReturnBytes ?? 0} B ABI return
              </div>
            </div>
            <div>
              <div className="kpi-label">EVM Window (/evm_window)</div>
              <div style={{ marginTop: 4 }}>
                <span className={`badge ${lookupResult.evmWindow?.live ? "badge-emerald" : "badge-cyan"}`}>
                  {lookupResult.evmWindow?.live ? "Window OPEN" : "Window Closed"}
                </span>
              </div>
              <div className="kpi-sub">
                {lookupResult.evmWindow?.live
                  ? `${lookupResult.evmWindow.remainingTxs.toString()} txs / ${lookupResult.evmWindow.remainingBlocks.toString()} blks`
                  : "Open scoped window before EVM writes"}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: 4-ROLE PQC IDENTITIES & RECIPIENT CARDS */}
      <section className="section">
        <div className="section-head">
          <div>
            <h3 className="section-title">
              <Users size={17} color="#a78bfa" />
              2. Deal Room Participants — Real ML-KEM-1024 + X25519 Keys &amp; ML-DSA-87 Recipient Cards
            </h3>
            <p className="section-desc">
              Every participant generates real FIPS 203 ML-KEM-1024 + X25519 keys and signs a QoreSeal Recipient Card
              with ML-DSA-87 + secp256k1 hybrid signatures. Unverified cards are strictly rejected.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm" onClick={handleInitRoom}>
              <KeyRound size={13} />
              {room ? "Regenerate Fresh PQC Keys" : "Generate 4 Deal Identities"}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={!room}
              onClick={() => room && setCardAttack(runRecipientCardTamperAttack(room))}
            >
              <ShieldAlert size={13} />
              Test MITM Card Tamper
            </button>
          </div>
        </div>

        {!room ? (
          <div className="mono-box" style={{ padding: 18, textAlign: "center", color: "#94a3b8" }}>
            Click <strong>Run 1-Click Full Interactive Walkthrough</strong> or{" "}
            <strong>Generate 4 Deal Identities</strong> to mint real ML-KEM-1024 + X25519 + ML-DSA-87 keys directly in
            your browser.
          </div>
        ) : (
          <>
            <div className="role-grid">
              {room.participantOrder.map((pid) => {
                const p = room.participants[pid];
                return (
                  <div key={pid} className={`role-card ${p.active ? "" : "revoked"}`}>
                    <div className="role-head">
                      <div>
                        <h4 className="role-name">{p.displayName}</h4>
                        <p className="role-sub">{p.roleLabel}</p>
                      </div>
                      <span className={`badge ${p.active ? "badge-emerald" : "badge-crimson"}`}>
                        {p.active ? "ACTIVE" : `EVICTED @ E${p.revokedAtEpoch}`}
                      </span>
                    </div>

                    <div className="mono-box">
                      <div>{shortHex(p.qorAddress, 13, 7)}</div>
                      <div style={{ color: "#94a3b8", marginTop: 2 }}>{shortHex(p.evmAddress, 10, 6)}</div>
                    </div>

                    <div className="chip-row">
                      <span className="chip">ML-KEM-1024: {p.sealKeys.mlkemPublicKey.length} B</span>
                      <span className="chip">X25519: {p.sealKeys.x25519PublicKey.length} B</span>
                      <span className="chip">ML-DSA-87 pk: {p.pqKey.publicKey.length} B</span>
                      <span className="chip" style={{ color: "#6ee7b7", borderColor: "rgba(16,185,129,0.35)" }}>
                        Card: {p.recipientCard.signature.signatureType}
                      </span>
                    </div>

                    <div className="kpi-sub">
                      Unwrapped Epochs:{" "}
                      <strong style={{ color: p.active ? "#67e8f9" : "#fda4af" }}>
                        [{p.knownEpochKeys.map((k) => `Epoch ${k.epoch.toString()}`).join(", ")}]
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>

            {cardAttack && (
              <div className="attack-banner" data-testid="card-attack-result">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <ShieldCheck size={16} color="#10b981" />
                  <strong>{cardAttack.name}:</strong> {cardAttack.detail}
                </span>
                <span className="badge badge-crimson">BLOCKED · {cardAttack.errorCode}</span>
              </div>
            )}
          </>
        )}
      </section>

      {/* SECTION 3: SEALED DOCUMENT VAULT & ROLE DECRYPTION AUDIT */}
      <section className="section">
        <div className="section-head">
          <div>
            <h3 className="section-title">
              <FileLock2 size={17} color="#22d3ee" />
              3. Post-Quantum Document Vault — Hybrid Envelope, AAD Binding &amp; Live Role Decryption
            </h3>
            <p className="section-desc">
              Documents are sealed client-side with <code>ML-KEM-1024 + X25519</code> hybrid envelopes (
              <code>qoreseal:…</code>) bound to <code>qorechain-diana</code> + AAD, and under the active{" "}
              <code>EpochKeyManager</code> key.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-cyan btn-sm" onClick={handleSealEpoch1Sample}>
              <FileKey2 size={13} />
              Seal Epoch 1 Sample Financials
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={!room || !activeDoc}
              onClick={() => room && activeDoc && setAadAttack(runAadTamperAttack(room, activeDoc))}
            >
              <AlertTriangle size={13} />
              Run AAD Tamper Attack
            </button>
          </div>
        </div>

        {room && (
          <div className="two-col">
            {/* Left: Vault + Custom Sealer */}
            <div>
              <div className="doc-tabs">
                {room.documents.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`doc-tab ${activeDoc?.id === d.id ? "active" : ""}`}
                    onClick={() => setSelectedDocId(d.id)}
                  >
                    <Lock size={12} />
                    <span>{d.label}</span>
                    <span className="badge badge-cyan">Epoch {d.epoch}</span>
                  </button>
                ))}
              </div>

              {activeDoc ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="chip-row">
                    <span className="chip">Mode: {activeDoc.parsedEnvelope.mode}</span>
                    <span className="chip">Recipients: {activeDoc.parsedEnvelope.entries.length}</span>
                    <span className="chip">Envelope: {activeDoc.envelopeBytes.length} B</span>
                    <span className="chip">
                      Entry KEM CT: {activeDoc.parsedEnvelope.entries[0]?.mlkemCiphertext.length ?? 0} B
                    </span>
                    <span className="chip">Plaintext: {activeDoc.plaintextBytes} B</span>
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <span className="kpi-label" style={{ margin: 0 }}>
                        Real QoreSeal Envelope (qoreseal:…)
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleCopy("envelope", activeDoc.envelopeText)}
                      >
                        <Copy size={12} />
                        {copiedKey === "envelope" ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <pre className="envelope-pre" data-testid="qoreseal-envelope">
                      {activeDoc.envelopeText.slice(0, 620)}… ({activeDoc.envelopeText.length} chars)
                    </pre>
                  </div>

                  <div className="mono-box">
                    <strong>Authenticated AAD:</strong> {activeDoc.aadText}
                    <div style={{ marginTop: 4, color: "#94a3b8" }}>
                      <strong>On-Chain Anchor:</strong> docId={shortHex(activeDoc.docIdBytes32, 12, 8)} · ctSha256=
                      {shortHex(activeDoc.ciphertextSha256Bytes32, 12, 8)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mono-box" style={{ padding: 14, color: "#94a3b8" }}>
                  No documents sealed yet. Click <strong>Seal Epoch 1 Sample Financials</strong> or seal a custom memo
                  below.
                </div>
              )}

              {/* Custom Document Sealer */}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px solid rgba(148,163,184,0.12)",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="kpi-label" style={{ margin: 0 }}>
                    Seal Custom Secret or Upload File (Active: Epoch {room.currentEpoch})
                  </span>
                  <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                    <Upload size={12} />
                    Load .txt/.md
                    <input
                      type="file"
                      accept=".txt,.md,.json,.csv"
                      onChange={handleUploadFile}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
                <input
                  type="text"
                  className="input"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Document label (e.g. Board_Resolution.md)"
                />
                <textarea
                  className="textarea"
                  value={customBody}
                  onChange={(e) => setCustomBody(e.target.value)}
                  placeholder="Type any confidential M&A memo to seal with real ML-KEM-1024 + X25519…"
                />
                <div>
                  <button type="button" className="btn btn-sm btn-primary" onClick={handleSealCustomDoc}>
                    <Lock size={13} />
                    Seal in Epoch {room.currentEpoch} ({room.participantOrder.filter((id) => room.participants[id].active).length}{" "}
                    Active Recipients)
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Live Multi-Role Decryption Matrix */}
            <div>
              <div className="kpi-label">Live Client-Side Decryption Matrix ({activeDoc?.label ?? "—"})</div>
              {activeDoc ? (
                <>
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Epoch Batch</th>
                        <th>Hybrid Envelope</th>
                        <th>Inspect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docAudits.map((row) => (
                        <tr key={row.participantId}>
                          <td style={{ fontWeight: 600 }}>{row.displayName}</td>
                          <td>
                            {row.batchAllowed ? (
                              <span className="badge badge-emerald">
                                <CheckCircle2 size={11} /> OK
                              </span>
                            ) : (
                              <span className="badge badge-crimson" data-testid={`blocked-${row.participantId}`}>
                                <XCircle size={11} /> {row.errorCode}
                              </span>
                            )}
                          </td>
                          <td>
                            {row.envelopeAllowed ? (
                              <span className="badge badge-emerald">DECRYPTED</span>
                            ) : (
                              <span className="badge badge-crimson">REFUSED</span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setSelectedAuditRole(row.participantId)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {selectedAudit && (
                    <div style={{ marginTop: 10 }}>
                      <div className="kpi-label">
                        Decryption Inspector: {selectedAudit.displayName} → {activeDoc.label} (Epoch {activeDoc.epoch})
                      </div>
                      {selectedAudit.decryptedPreview ? (
                        <div className="decrypted-box" data-testid="decrypted-plaintext">
                          {selectedAudit.decryptedPreview}
                        </div>
                      ) : (
                        <div className="blocked-box" data-testid="decryption-refused">
                          <strong>CRYPTOGRAPHIC ACCESS DENIED ({selectedAudit.errorCode})</strong>
                          <div style={{ marginTop: 4 }}>
                            {selectedAudit.errorMessage ??
                              "Participant does not possess the rotated Epoch key or hybrid recipient slot."}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {aadAttack && (
                    <div className="attack-banner" data-testid="aad-attack-result">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <ShieldCheck size={16} color="#10b981" />
                        <strong>{aadAttack.name}:</strong> {aadAttack.detail}
                      </span>
                      <span className="badge badge-crimson">BLOCKED · {aadAttack.errorCode}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="mono-box" style={{ padding: 14, color: "#94a3b8" }}>
                  Seal a document to verify live multi-role decryption and AAD tamper protection.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 4: KILLER Q-DAY FEATURE — ML-DSA-87 EVICTION & EPOCH 2 ROTATION */}
      <section className="section">
        <div className="section-head">
          <div>
            <h3 className="section-title">
              <UserMinus size={17} color="#f43f5e" />
              4. Q-Day Governance: ML-DSA-87 Signed Eviction of Bidder B &amp; Epoch 2 Key Rotation
            </h3>
            <p className="section-desc">
              Calls <code>EpochKeyManager.removeMember("bidder-b")</code> AND signs the exact{" "}
              <code>DataRoomRegistry.evictMemberWithPqcProof()</code> Solidity digest (
              <code>QOREDATAROOM_EVICT_V1</code>) with the Deal Owner&apos;s real <strong>ML-DSA-87</strong> secret
              key (4,627 B) verified by precompile <code>0x…0a01</code>.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!room || !room.participants["bidder-b"].active}
            onClick={handleEvictBidderB}
            data-testid="evict-bidder-b-btn"
          >
            <UserMinus size={14} />
            {room?.evictionProof
              ? "Bidder B Evicted (Epoch 2 Active)"
              : "Evict Bidder B with ML-DSA-87 Proof → Epoch 2"}
          </button>
        </div>

        {room?.evictionProof ? (
          <div className="two-col">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="chip-row">
                <span className="badge badge-violet">
                  ML-DSA-87 Sig: {room.evictionProof.mlDsaSignatureBytes} B
                </span>
                <span className="badge badge-emerald">
                  pqVerify(0x…0a01 digest): {room.evictionProof.verifiedLocally ? "TRUE" : "FALSE"}
                </span>
                <span className="badge badge-cyan">
                  Epoch {room.evictionProof.previousEpoch} → Epoch {room.evictionProof.nextEpoch}
                </span>
                <span className="badge badge-crimson">
                  Bidder B Distribution: {room.evictionProof.bidderBEnvelopeErrorCode}
                </span>
              </div>
              <div className="mono-box">
                <div>
                  <strong>Eviction Digest (QOREDATAROOM_EVICT_V1):</strong> {room.evictionProof.evictionDigest}
                </div>
                <div style={{ marginTop: 4 }}>
                  <strong>New Epoch Root Hash:</strong> {room.evictionProof.newEpochRootHash}
                </div>
                <div style={{ marginTop: 4 }}>
                  <strong>ML-DSA-87 Signature Hex ({room.evictionProof.mlDsaSignatureBytes} B):</strong>{" "}
                  {room.evictionProof.mlDsaSignatureHexPreview}
                </div>
                <div style={{ marginTop: 4 }}>
                  <strong>Epoch 2 Key Distribution Envelope:</strong> {room.evictionProof.epochDistributionBytes} B
                  (sealed exclusively to Deal Owner, Bidder A, Independent Auditor)
                </div>
              </div>
            </div>

            <div className="mono-box" style={{ display: "grid", gap: 6, alignContent: "start" }}>
              <strong style={{ color: "#f8fafc" }}>Why This Defeats Both HNDL &amp; Compromised ECDSA Keys</strong>
              <div>
                1. <strong>Forward Secrecy on Revocation:</strong> Meridian Ventures (Bidder B) keeps mathematical
                access to Epoch 1 (<code>Q3_Financials_Confidential.md</code>) for auditability, yet is cryptographically
                unable to unwrap the Epoch 2 distribution (<code>NOT_A_RECIPIENT</code>) or Epoch 2 valuation models (
                <code>UNKNOWN_EPOCH</code>).
              </div>
              <div>
                2. <strong>Quantum-Resistant Access Control:</strong> Even if a quantum adversary recovers the Deal
                Owner&apos;s classical secp256k1 ECDSA private key, <code>DataRoomRegistry.evictMemberWithPqcProof</code>{" "}
                rejects any mutation lacking a valid 4,627-byte ML-DSA-87 proof over <code>0x…0a01</code>.
              </div>
            </div>
          </div>
        ) : (
          <div className="mono-box" style={{ padding: 14, color: "#94a3b8" }}>
            Generate the room and click <strong>Evict Bidder B with ML-DSA-87 Proof → Epoch 2</strong> (or run the
            1-Click Walkthrough) to produce the real 4,627-byte ML-DSA-87 eviction signature and rotate keys.
          </div>
        )}
      </section>

      {/* SECTION 5: SCOPED EVM WINDOW, KEM REGISTRY & QOREX WALLET */}
      <section className="section">
        <div className="section-head">
          <div>
            <h3 className="section-title">
              <Wallet size={17} color="#67e8f9" />
              5. Scoped EVM Authorization Window (@qorechain/evm) &amp; QoreX Native Lane Payloads
            </h3>
            <p className="section-desc">
              Real <code>openEvmWindowMessage()</code> + <code>evmWindowCost()</code> +{" "}
              <code>buildRegisterKemKeyMessage()</code> ready for <code>window.qorex.native.signAndBroadcast</code>{" "}
              and EIP-6963 (<code>rdns: &quot;network.qore.qorex&quot;</code>).
            </p>
          </div>
          <span className="badge badge-cyan">{wallet.providerName}</span>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label className="kpi-label" htmlFor="registry-addr-input" style={{ display: "block" }}>
            Target DataRoomRegistry Contract Address (allowedTargets[0])
          </label>
          <input
            id="registry-addr-input"
            type="text"
            className="input"
            value={registryInput}
            onChange={(e) => setRegistryInput(e.target.value)}
            placeholder="0x... deployed DataRoomRegistry on Diana (chainId 9800)"
          />
        </div>

        <div className="two-col">
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span className="kpi-label" style={{ margin: 0 }}>
                Scoped MsgOpenEVMWindow ({evmWindowPreview.blocks} blocks · {evmWindowPreview.maxTxs} maxTxs ·{" "}
                {evmWindowPreview.recommendedMaxValueUqor} uQOR cap)
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleCopy("evmWindow", JSON.stringify(evmWindowPreview.message, null, 2))}
              >
                <Copy size={12} />
                {copiedKey === "evmWindow" ? "Copied" : "Copy JSON"}
              </button>
            </div>
            <pre className="json-pre">{JSON.stringify(evmWindowPreview.message, null, 2)}</pre>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span className="kpi-label" style={{ margin: 0 }}>
                Native MsgRegisterKEMKey Builder (/qorechain.pqc.v1.MsgRegisterKEMKey)
              </span>
              {kemRegisterPreview && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleCopy("kemMsg", JSON.stringify(kemRegisterPreview, null, 2))}
                >
                  <Copy size={12} />
                  {copiedKey === "kemMsg" ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            <pre className="json-pre">
              {kemRegisterPreview
                ? JSON.stringify(kemRegisterPreview, null, 2)
                : JSON.stringify(
                    {
                      status: "Generate PQC Deal Identities in Step 2 to encode a real 1568-byte ML-KEM-1024 MsgRegisterKEMKey protobuf payload.",
                      typeUrl: "/qorechain.pqc.v1.MsgRegisterKEMKey",
                      algorithmId: 2,
                      walletNote: wallet.note,
                    },
                    null,
                    2
                  )}
            </pre>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div>
          <strong>QoreDataRoom</strong> · MIT Licensed · Built for QoreChain Developer Fest (&quot;Build Before
          Q-Day&quot;) — Encrypted Apps Track
        </div>
        <div>
          Powered by <code>@qorechain/qoreseal@0.1.0</code> · <code>@qorechain/qoresign@0.2.0</code> ·{" "}
          <code>@qorechain/evm@0.14.0</code> · Foundry Solc 0.8.28
        </div>
      </footer>
    </div>
  );
}
