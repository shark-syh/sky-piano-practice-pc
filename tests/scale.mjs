import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9349;
const userDir = mkdtempSync(join(tmpdir(), "edge-scale-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--window-size=1280,800",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
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
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300)); return r.result.value; };
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(()=>"?") === "complete") break; await sleep(200); }
await sleep(800);

const measure = async () => ev(`(() => {
  const fs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontSize : null; };
  const key = document.querySelector('#pianoFree .key');
  return {
    innerWidth, innerHeight, scale: window.UI_SCALE || (typeof UI_SCALE !== 'undefined' ? UI_SCALE : null),
    h1: fs('.topbar h1'), tab: fs('.mode-tabs .tab'), hint: fs('.hint'), btn: fs('#audioEnable'),
    keyLetter: key ? getComputedStyle(key.querySelector('.kb')).fontSize : null,
    keyH: key ? Math.round(key.getBoundingClientRect().height) : null,
    fitsV: document.documentElement.scrollHeight <= innerHeight + 1,
    fitsH: document.documentElement.scrollWidth <= innerWidth + 1,
  };
})()`);

const out = {};
out.base = await measure();
out.baseScale = await ev(`typeof UI_SCALE !== 'undefined' ? UI_SCALE : 'undefined'`);

await send("Emulation.setDeviceMetricsOverride", { width: 1900, height: 1200, deviceScaleFactor: 1, mobile: false }, sid);
await sleep(900);
out.large = await measure();
const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/layout-large-1900x1200.png", Buffer.from(shot.data, "base64"));

await send("Emulation.setDeviceMetricsOverride", { width: 2400, height: 1500, deviceScaleFactor: 1, mobile: false }, sid);
await sleep(900);
out.huge = await measure();
console.log(JSON.stringify(out, null, 2));
edge.kill(); process.exit(0);
