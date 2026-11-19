#!/usr/bin/env node
// Runs page probes in headless Chromium over the DevTools protocol (browser-compatibility checks on the Ubuntu VM).
//   node chromium_probe.mjs --url http://127.0.0.1:3111/ --probe probes/smoke-create.js [--file /path/design.lyl --open-wait-ms 240000] [--samples chrome-rss.csv]
// A probe is an async function body (use `return`), as for the macOS host. With --file the .lyl is put into the start page's file input
// (the "Open a design" tile), the editor is awaited, and the renderer memory peak and open time are recorded.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : a), []));
const chrome = process.env.CHROME || path.join(os.homedir(), ".cache/ms-playwright/chromium-1208/chrome-linux/chrome");
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-profile-"));
const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1440,900",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rssMB() { // total RSS of this browser's processes (renderer + gpu + browser), from /proc
  let total = 0, renderer = 0;
  for (const pid of fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmd.includes(profile)) continue;
      const kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
      total += kb; if (cmd.includes("--type=renderer")) renderer += kb;
    } catch { /* process gone */ }
  }
  return { total: total / 1024, renderer: renderer / 1024 };
}

let id = 0; const waiting = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) { const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
        return ws; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("DevTools endpoint did not come up");
}
const send = (ws, method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (ws, body, ms = 300000) => {
  const r = await send(ws, "Runtime.evaluate", { expression: `(async () => { ${body}\n})()`, awaitPromise: true, returnByValue: true, timeout: ms });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

const out = { browser: "Chromium", chrome };
let peak = { total: 0, renderer: 0 }; const timer = setInterval(() => { const m = rssMB(); peak = { total: Math.max(peak.total, m.total), renderer: Math.max(peak.renderer, m.renderer) }; }, 250);
try {
  const ws = await connect();
  await send(ws, "Page.enable"); await send(ws, "Runtime.enable"); await send(ws, "DOM.enable");
  const errors = []; ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0] ?? d.params.exceptionDetails.text); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200)); });
  await send(ws, "Page.navigate", { url: args.url });
  await sleep(4000);
  if (args.file) {
    const doc = (await send(ws, "DOM.getDocument", { depth: -1 })).result.root;
    const q = await send(ws, "DOM.querySelectorAll", { nodeId: doc.nodeId, selector: "input[type=file]" });
    const nodeId = q.result.nodeIds[0];
    if (!nodeId) throw new Error("no file input on the start page");
    const t0 = Date.now();
    await send(ws, "DOM.setFileInputFiles", { nodeId, files: [args.file] });
    if (args.background) { // switch to another tab right after the open starts, so the page under test is hidden (background-tab throttling)
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      out.background = true;
    }
    const waitMs = Number(args["open-wait-ms"] ?? 240000);
    let ready = false;
    while (Date.now() - t0 < waitMs) {
      ready = await evaluate(ws, `return !!(document.querySelector('canvas') && [...document.querySelectorAll('button')].some(x => x.getAttribute('aria-label') === 'Add shape'))`, 20000);
      if (ready === true) break; await sleep(500);
    }
    out.open = { ready, hiddenState: await evaluate(ws, "return document.visibilityState", 20000), ms: Date.now() - t0, rssPeakMB: Math.round(peak.total), rendererPeakMB: Math.round(peak.renderer) };
    await sleep(8000); const m = rssMB(); out.open.settledMB = Math.round(m.total); out.open.settledRendererMB = Math.round(m.renderer);
  }
  if (args.probe) out.probe = await evaluate(ws, fs.readFileSync(args.probe, "utf8"));
  out.pageErrors = errors.slice(0, 10);
  out.rssPeakMB = Math.round(peak.total);
  ws.close();
} catch (e) { out.failure = String(e); } finally { clearInterval(timer); proc.kill("SIGKILL"); }
console.log(JSON.stringify(out));
process.exit(0);
