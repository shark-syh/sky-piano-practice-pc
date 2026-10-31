import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const W = Number(process.argv[2] || 907), H = Number(process.argv[3] || 600);
const PORT = 9336;
const userDir = mkdtempSync(join(tmpdir(), "edge-layout-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run",`--window-size=${W},${H}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { version = await r.json(); break; } } catch {} await sleep(250); }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const t = await send("Target.createTarget", { url: "http://127.0.0.1:8766/" });
const a = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
const sid = a.sessionId;
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
for (let i = 0; i < 60; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(500);
const info = await ev(`(() => {
  const k = document.querySelector('#pianoFree .piano-row');
  const key = document.querySelector('#pianoFree .key');
  return {
    innerWidth, innerHeight,
    dpr: devicePixelRatio,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rowWidth: k.getBoundingClientRect().width,
    keyWidth: key.getBoundingClientRect().width,
    rowColumns: getComputedStyle(k).gridTemplateColumns,
    cssLoaded: [...document.styleSheets].map(s=>s.href),
  };
})()`);
console.log(JSON.stringify(info, null, 2));
const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
writeFileSync(`D:/rea-tools/skystudio-pc/docs/layout-${W}x${H}.png`, Buffer.from(shot.data, "base64"));
edge.kill();
process.exit(0);
