import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9348;
const userDir = mkdtempSync(join(tmpdir(), "edge-free-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--window-size=1280,860",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
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
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }, sid); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300)); return r.result.value; };
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(()=>"?") === "complete") break; await sleep(200); }
await sleep(900);
await ev(`switchTab('free')`);
await sleep(500);

const measure = async () => ev(`(() => {
  const stage = document.querySelector('#freeStage').getBoundingClientRect();
  const kb = document.querySelector('#pianoFree').getBoundingClientRect();
  const key = document.querySelector('#pianoFree .key').getBoundingClientRect();
  const c = document.querySelector('#freeRoll');
  return {
    innerHeight, innerWidth,
    fitsV: document.documentElement.scrollHeight <= innerHeight + 1,
    fitsH: document.documentElement.scrollWidth <= innerWidth + 1,
    stageH: Math.round(stage.height), kbH: Math.round(kb.height), keyH: Math.round(key.height),
    canvas: [c.width, c.height], vertical: kb.top >= stage.bottom - 2,
  };
})()`);
const out = {};
out.at1280 = await measure();

// 弹几个音
for (const [c,k] of [["KeyY","y"],["KeyU","u"],["KeyI","i"],["KeyH","h"],["KeyN","n"]]) {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: '${c}', key: '${k}', bubbles: true }))`);
  await sleep(160);
  await ev(`document.dispatchEvent(new KeyboardEvent('keyup', { code: '${c}', key: '${k}', bubbles: true }))`);
  await sleep(90);
}
await sleep(400);
out.afterPlay = await ev(`({ notes: state.freeNotes.length, msgHidden: getComputedStyle(document.querySelector('#freeMsg')).display === 'none' })`);
const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/screenshot-free.png", Buffer.from(shot.data, "base64"));

// 点击音轨清空
await ev(`document.querySelector('#freeStage').click()`);
await sleep(250);
out.afterClear = await ev(`({ notes: state.freeNotes.length })`);

// 900x650
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 650, deviceScaleFactor: 1, mobile: false }, sid);
await sleep(600);
out.at900 = await measure();
const shot2 = await send("Page.captureScreenshot", { format: "png" }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/layout-free-900x650.png", Buffer.from(shot2.data, "base64"));
await send("Emulation.clearDeviceMetricsOverride", {}, sid);
console.log(JSON.stringify(out, null, 2));
edge.kill(); process.exit(0);
