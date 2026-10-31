// 生成 README 截图：三页 @1280x860
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9352;
const userDir = mkdtempSync(join(tmpdir(), "edge-readme-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--window-size=1280,860`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-sandbox", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { version = await r.json(); break; } } catch {}
  await sleep(250);
}
if (!version) { console.error("CDP 启动失败"); edge.kill(); process.exit(1); }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const t = await send("Target.createTarget", { url: "http://127.0.0.1:8766/" });
const a = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
const sid = a.sessionId;
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
for (let i = 0; i < 100; i++) { if (await ev("document.readyState").catch(() => "?") === "complete") break; await sleep(200); }
await sleep(1000);

const out = [];
for (const tab of ["free", "import", "practice"]) {
  await ev(`switchTab('${tab}')`);
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
  writeFileSync(`docs/screenshot-${tab}.png`, Buffer.from(shot.data, "base64"));
  out.push(await ev(`({ tab: '${tab}', w: innerWidth, h: innerHeight, title: document.title })`));
}
console.log(JSON.stringify(out, null, 2));
edge.kill();
process.exit(0);
