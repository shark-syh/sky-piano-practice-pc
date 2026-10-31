// 极小窗口自适应检查
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9345;
const userDir = mkdtempSync(join(tmpdir(), "edge-small-"));
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
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300)); return r.result.value; };
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(()=>"?") === "complete") break; await sleep(200); }
const results = [];
for (const [w,h] of [[850,560],[800,520],[1024,640]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid);
  await sleep(600);
  const m = await ev(`(() => {
    const roll = document.querySelector('#editorScroll').getBoundingClientRect();
    const kb = document.querySelector('#pianoWorkbench').getBoundingClientRect();
    const card = document.querySelector('.studio-card').getBoundingClientRect();
    return { w: ${w}, h: ${h}, innerHeight, scrollHeight: document.documentElement.scrollHeight,
      fitsV: document.documentElement.scrollHeight <= innerHeight + 1,
      fitsH: document.documentElement.scrollWidth <= innerWidth + 1,
      rollH: Math.round(roll.height), kbH: Math.round(kb.height),
      kbBottom: Math.round(kb.bottom), cardBottom: Math.round(card.bottom), rowH: EDITOR_METRICS.rowH };
  })()`);
  results.push(m);
  const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
  writeFileSync(`D:/rea-tools/skystudio-pc/docs/small-${w}x${h}.png`, Buffer.from(shot.data, "base64"));
}
console.log(JSON.stringify(results, null, 2));
edge.kill(); process.exit(0);
