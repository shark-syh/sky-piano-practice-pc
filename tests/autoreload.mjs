// 自动刷新测试：修改 style.css 后页面应自动 reload
import { spawn } from "node:child_process";
import { mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9342;
const userDir = mkdtempSync(join(tmpdir(), "edge-auto-"));
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
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(1500);
const before = await ev(`({ marker: (window.__autoTest = 12345), version: document.title })`);
const v1 = await (await fetch("http://127.0.0.1:8766/__version")).json();
appendFileSync("D:/rea-tools/skystudio-pc/style.css", "\n/* auto-reload probe " + Date.now() + " */\n");
await sleep(3500);
const after = await ev(`({ marker: window.__autoTest === undefined ? "cleared(已刷新)" : String(window.__autoTest) })`);
const v2 = await (await fetch("http://127.0.0.1:8766/__version")).json();
console.log(JSON.stringify({ v1, v2, changed: v1.version !== v2.version, after }, null, 2));
edge.kill();
process.exit(0);
