import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9344;
const userDir = mkdtempSync(join(tmpdir(), "edge-ov-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--window-size=1280,860",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { version = await r.json(); break; } } catch {} await sleep(250); }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const t = await send("Target.createTarget", { url: "http://127.0.0.1:8766/#import" });
const a = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
const sid = a.sessionId;
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400)); return r.result.value; };
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(()=>"?") === "complete") break; await sleep(200); }
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 650, deviceScaleFactor: 1, mobile: false }, sid);
await sleep(800);
const info = await ev(`(() => {
  const out = { innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, offenders: [] };
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 && r.width > 40) {
      out.offenders.push({ tag: el.tagName, cls: el.className && String(el.className).slice(0,60), id: el.id, right: Math.round(r.right), width: Math.round(r.width), scrollW: el.scrollWidth });
    }
    if (out.offenders.length > 25) break;
  }
  return out;
})()`);
console.log(JSON.stringify(info, null, 2));
edge.kill(); process.exit(0);
