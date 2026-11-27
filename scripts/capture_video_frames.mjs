#!/usr/bin/env node
/**
 * Captures 4 crisp 16:9 (1280x720 @ 2x = 2560x1440, fullPage: false) walkthrough frames
 * for QoreDataRoom's <= 3 minute QoreChain Developer Fest demo video.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT, "web");
const OUT_DIR = process.argv[2] || "/tmp/qore_video_frames/qoredataroom";
const CHROME_BIN =
  process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PREVIEW_PORT = 4182;
const CDP_PORT = 9342;
const APP_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;

fs.mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return true;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (e) => reject(e));
    });
    this.ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const list = this.listeners.get(msg.method) ?? [];
        for (const fn of list) fn(msg.params);
      }
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails?.text || "Eval failed");
    }
    return res.result?.value;
  }
  async scrollToSelector(selector) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
      return Boolean(el);
    })()`);
    await sleep(350);
  }
  async screenshotViewport(outPath) {
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.writeFileSync(outPath, Buffer.from(data, "base64"));
  }
  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function main() {
  const previewProc = spawn(
    "npx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    { cwd: WEB_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );

  const userDataDir = `/tmp/qoredataroom-video-chrome-${Date.now()}`;
  const chromeProc = spawn(
    CHROME_BIN,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--window-size=1280,720",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let cdp = null;
  try {
    await waitForHttp(APP_URL);
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
    const pageTarget = targets.find((t) => t.type === "page");
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error("Could not find Chrome page target for CDP");
    }

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.ready;

    const consoleErrors = [];
    const pageErrors = [];
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        const text = (params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
        consoleErrors.push(text);
      }
    });
    cdp.on("Runtime.exceptionThrown", (params) => {
      pageErrors.push(params.exceptionDetails?.text ?? JSON.stringify(params.exceptionDetails));
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
      mobile: false,
    });

    await cdp.send("Page.navigate", { url: APP_URL });
    await sleep(3200);

    // Frame 1: Initial hero & Diana live deal-room workspace
    await cdp.eval(`window.scrollTo(0, 0)`);
    await sleep(300);
    await cdp.screenshotViewport(path.join(OUT_DIR, "01_hero_workspace.png"));

    // Click 1-Click Full Interactive Walkthrough
    const clicked = await cdp.eval(`(() => {
      const btn = document.querySelector('[data-testid="walkthrough-btn"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!clicked) throw new Error("Missing walkthrough-btn");

    let checks = null;
    for (let i = 0; i < 35; i++) {
      await sleep(300);
      checks = await cdp.eval(`(() => {
        const summary = document.querySelector('[data-testid="walkthrough-summary"]')?.textContent ?? null;
        const cardAttack = document.querySelector('[data-testid="card-attack-result"]')?.textContent ?? null;
        const aadAttack = document.querySelector('[data-testid="aad-attack-result"]')?.textContent ?? null;
        const blockedBidderB = document.querySelector('[data-testid="blocked-bidder-b"]')?.textContent ?? null;
        const envelope = document.querySelector('[data-testid="qoreseal-envelope"]')?.textContent ?? null;
        const lookup = document.querySelector('[data-testid="diana-lookup-result"]')?.textContent ?? null;
        return {
          summary,
          cardAttack,
          aadAttack,
          blockedBidderB,
          hasEnvelope: Boolean(envelope && envelope.includes("qoreseal:")),
          hasLookup: Boolean(lookup),
        };
      })()`);
      if (checks?.summary && checks?.blockedBidderB) break;
    }

    if (!checks?.summary || !checks?.hasEnvelope) throw new Error("Walkthrough summary or envelope missing");
    if (!checks?.blockedBidderB?.includes("UNKNOWN_EPOCH")) throw new Error(`Missing UNKNOWN_EPOCH: ${checks?.blockedBidderB}`);
    if (!checks?.aadAttack?.includes("DECRYPTION_FAILED")) throw new Error(`Missing DECRYPTION_FAILED: ${checks?.aadAttack}`);
    if (!checks?.cardAttack?.includes("CARD_INVALID")) throw new Error(`Missing CARD_INVALID: ${checks?.cardAttack}`);

    // Frame 2: Real qoreseal: ML-KEM-1024 + AES-256-GCM envelope & walkthrough summary
    await cdp.scrollToSelector('[data-testid="qoreseal-envelope"]');
    await cdp.screenshotViewport(path.join(OUT_DIR, "02_walkthrough_envelope.png"));

    // Frame 3: Live Diana Testnet PQC/KEM verification lookup
    await cdp.scrollToSelector('[data-testid="diana-lookup-result"]');
    await cdp.screenshotViewport(path.join(OUT_DIR, "03_diana_onchain_lookup.png"));

    // Frame 4: Cryptographic tamper & post-eviction forward secrecy proofs
    await cdp.scrollToSelector('[data-testid="blocked-bidder-b"]');
    await cdp.screenshotViewport(path.join(OUT_DIR, "04_security_proofs.png"));

    console.log(JSON.stringify({
      status: "PASS",
      outDir: OUT_DIR,
      checks,
      pageErrorsCount: pageErrors.length,
      consoleErrorsCount: consoleErrors.length,
    }, null, 2));

    if (pageErrors.length > 0 || consoleErrors.length > 0) {
      console.error("Errors:", { pageErrors, consoleErrors });
      process.exitCode = 1;
    }
  } finally {
    if (cdp) cdp.close();
    previewProc.kill("SIGTERM");
    chromeProc.kill("SIGTERM");
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error("CAPTURE FAILED:", err);
  process.exit(1);
});
