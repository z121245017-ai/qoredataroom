# AI Usage & Engineering Log — QoreDataRoom

> Submitted for the **Best AI-Native Build (`$500`)** Special Award at **QoreChain Developer Fest ("Build Before Q-Day")**.

This document is a transparent, evidence-backed engineering log detailing how AI agents collaborated across live network probing, Solidity contract engineering, post-quantum cryptography integration, automated fuzzing, and headless Chrome verification — including every real-world protocol mismatch and bug discovered and resolved along the way.

---

## 1. AI-Native Engineering Workflow

Rather than generating boilerplate from stale assumptions, the build followed a **live-verification-first agentic loop**:

1. **Live Testnet Ground-Truthing:** Before finalizing Solidity interfaces or frontend clients, the agent queried live QoreChain Diana endpoints (`https://rpc-testnet.qore.host/status`, `https://api-testnet.qore.host/qorechain/pqc/v1/{kem,account,evm_window}/{qor1}`, and raw `eth_call` invocations against `0x...0a01` and `0x...0a02` on `https://evm-testnet.qore.host`).
2. **Runtime SDK Introspection:** Immediately after `npm install`, the agent inspected the exact runtime exports and compiled `.d.ts` definitions of `@qorechain/qoreseal@0.1.0`, `@qorechain/qoresign@0.2.0`, `@qorechain/evm@0.14.0`, `@qorechain/sdk@0.14.0`, and `@qorechain/pqc@0.2.3` instead of guessing method signatures.
3. **Precompile-Fidelity Foundry Testing:** Modeled both QoreChain precompiles (`0x...0a01` and `0x...0a02`) using Foundry `vm.etch`, including negative fault-injection (`forceEmptyReturn = true`) and `256`-run stateful fuzz tests across access control, forged ML-DSA signatures, and PQC key status combinations.
4. **Zero-Mock Cryptographic Unit Testing:** Wrote Vitest tests in `web/src/lib/pqcDataRoom.test.ts` executing real NIST FIPS 203 ML-KEM-1024 + X25519 sealing and real NIST FIPS 204 ML-DSA-87 signing/verification (`2592 B` pubkeys, `4627 B` signatures).
5. **Automated Headless Browser QA:** Authored a zero-dependency Chrome DevTools Protocol harness (`scripts/qa_capture.mjs`) using Node 24 native WebSocket to execute the full interactive 1-click walkthrough against the production Vite bundle and assert `0` console errors, `0` page errors, `0` horizontal overflow, and live DOM cryptographic proofs.

---

## 2. Concrete Protocol Bugs & Edge Cases Caught and Fixed

### Bug Catch #1 — Live Diana `0x...0a02` 4-Tuple Return vs `@qorechain/evm@0.14.0` 3-Tuple ABI
- **What live probing revealed:** Inspecting `@qorechain/evm@0.14.0`'s bundled `IQORE_PQC_ABI` showed only 3 outputs for `pqcKeyStatus(address)`: `(bool registered, uint8 algorithmId, bytes pubkey)`. However, sending a raw `eth_call` (`selector 0x850dfe51`) directly to live Diana Testnet `0x0000000000000000000000000000000000000a02` returned **160 bytes** whose 5 head words were:
  ```text
  word 0: 0x00...00 (bool registered)
  word 1: 0x00...00 (uint8 algorithmId)
  word 2: 0x00...80 (offset 128 bytes -> proves 4 head words before dynamic bytes!)
  word 3: 0x00...00 (bool possessionProven)
  word 4: 0x00...00 (length of bytes pubkey = 0)
  ```
- **Why this mattered:** Relying blindly on the 3-tuple ABI would have silently ignored `possessionProven`, potentially admitting accounts that uploaded a public key without proving possession of the corresponding ML-DSA-87 private key.
- **Fix applied:** Both `contracts/src/interfaces/IQorePQC.sol` (`QorePQCLib.queryKeyStatus`, requiring `ok && ret.length >= 128` and enforcing `registered && possessionProven && algorithmId == 1`) and `web/src/lib/diana.ts` (`LIVE_PQC_PRECOMPILE_ABI` + `queryPrecompileKeyStatus`) explicitly decode and enforce all 4 outputs.

### Bug Catch #2 — Mixed-Case Address Checksum Failures in Solc `0.8.28` & `viem`
- **What happened:** Solidity `0.8.28` with `deny = "warnings"` rejects non-checksummed mixed-case address literals, and our first Vitest run immediately caught `InvalidAddressError` in `viem`'s `encodeAbiParameters` on the placeholder address `"0x000000000000000000000000000000000000dA7a"`.
- **Fix applied:** Standardized all precompile addresses (`0x0000000000000000000000000000000000000a01`, `0x0000000000000000000000000000000000000a02`) and default registry placeholder (`0x000000000000000000000000000000000000da7a`) to all-lowercase across Solidity and TypeScript.

### Bug Catch #3 — Missing Browser CORS Headers on Diana REST LCD (`api-testnet.qore.host`)
- **What happened:** Browser fetches directly to `https://api-testnet.qore.host/qorechain/pqc/v1/kem/{qor1}` fail under CORS.
- **Fix applied:** Configured identical reverse proxies (`/lcd`, `/cosmos-rpc`, `/evm-rpc`) under BOTH `server.proxy` AND `preview.proxy` in `web/vite.config.ts`, enabling `@qorechain/evm`'s `evmWindowStatus({ rest: "/lcd", address })` and live `/lcd/qorechain/pqc/v1/kem/{qor1}` queries to execute with **0 console errors** in both dev and production preview modes.

### Bug Catch #4 — Bypassing Broken `@qorechain/react` `useTx`
- **What happened:** `@qorechain/react`'s `useTx` hook is known to fail against QoreChain's hybrid signing flow.
- **Fix applied:** Implemented zero-dependency direct wallet discovery in `web/src/lib/diana.ts` using `window.qorex.native` (`signAndBroadcast` / `signArbitrary`) + EIP-6963 provider announcement filtering strictly for `rdns === "network.qore.qorex"`, paired with real `@qorechain/evm` `openEvmWindowMessage` + `evmWindowCost` and `@qorechain/qoreseal` `buildRegisterKemKeyMessage`.

### Bug Catch #5 — Foundry `vm.expectRevert` Consumed by External Constant Getters
- **What happened:** On the first `forge test -vv` execution, 3 tests (`test_AddMemberRequiresPqcVerification`, `test_FreezeRoomWithPqcProofLocksAllMutations`, `testFuzz_UnauthorizedCallerCannotAddMemberOrEvict`) failed with `next call did not revert as expected` because calling `registry.ROLE_BIDDER()` inside the arguments of `registry.addMember(...)` after `vm.expectRevert` executed an external `staticcall` first and consumed the revert expectation.
- **Fix applied:** Cached `uint8 roleBidder = registry.ROLE_BIDDER()` / `roleCounsel = registry.ROLE_COUNSEL()` prior to `vm.prank` and `vm.expectRevert`. Result: **13/13 tests pass** (`9` unit + `4` fuzz suites × `256` runs = `1,024` fuzz cases, `0` warnings).

### Bug Catch #6 — Headless Chrome Temp Profile Lock on Exit
- **What happened:** `scripts/qa_capture.mjs` passed every browser assertion (`0` page errors, `0` console errors, `0` horizontal overflow, `120 ms` full walkthrough) but hit `ENOTEMPTY` deleting the Chrome temporary user-data directory immediately after `SIGTERM`.
- **Fix applied:** Added a 300ms shutdown grace delay and retry options on `fs.rmSync` cleanup so the QA script exits cleanly with status `0`.

---

## 3. Security, Privacy & Integrity Guardrails

- **Zero Mocked Cryptography in Web or Tests:** Every keypair, Recipient Card, hybrid `qoreseal:` envelope, `EpochKeyManager` rotation, and `4627 B` ML-DSA-87 eviction signature is computed live by `@qorechain/qoreseal` and `@qorechain/qoresign`.
- **Zero Secrets in Code or Logs:** `contracts/script/DeployDiana.s.sol` reads `PRIVATE_KEY` solely via `vm.envUint("PRIVATE_KEY")` at runtime; `.gitignore` excludes `.env*` and `contracts/broadcast/`.
- **Strict Non-Fabrication Policy:** Live Diana deployment hashes are explicitly marked `[Pending live Diana broadcast]` rather than fabricating synthetic transaction IDs.

---

## 4. Verification Summary (All Commands Re-Verified)

| Check | Command | Verified Result |
| --- | --- | --- |
| **Foundry Unit + Fuzz Tests** | `cd contracts && forge test -vv` | **PASS** — `13/13` passed (`9` unit + `4 × 256` fuzz runs), Solc `0.8.28`, `0` warnings |
| **Real PQC Vitest Suite** | `cd web && npm test` | **PASS** — `4/4` real cryptographic test suites passed (~444 ms) |
| **TypeScript + Vite Production Build** | `cd web && npm run build` | **PASS** — `tsc -b` + `vite build` succeeded cleanly in ~1.06 s |
| **Headless Chrome Live QA** | `node scripts/qa_capture.mjs` | **PASS** — `0` console errors, `0` page errors, `0` horizontal overflow, `120 ms` end-to-end walkthrough |
| **Cover Image Generation** | `swift scripts/render_cover.swift docs/cover-1920x1080.png` | **PASS** — `1920×1080` PNG rendered (`docs/cover-1920x1080.png`) |
| **QoreScan CBOM Attempt** | `npx -y @qorechain/qorescan scan --network testnet --out docs/cbom.json` | Gracefully skipped (`qorescan: fetch failed` against external scanner endpoint) |
