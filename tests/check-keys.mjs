// 快速校验：新按键映射 + 水钢琴音色加载
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9334;
const userDir = mkdtempSync(join(tmpdir(), "edge-check-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
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
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
for (let i = 0; i < 60; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(600);
const result = await ev(`(async () => {
  const map = {};
  for (const code of ['KeyY','KeyU','KeyI','KeyO','KeyP','KeyH','KeyJ','KeyK','KeyL','Semicolon','KeyN','KeyM','Comma','Period','Slash']) map[code] = KEY_TO_INDEX.get(code);
  const labels = KEY_LABELS.slice(0,15).join('');
  const notes = NOTE_LETTERS.slice(0,15).join('');
  const rows = [...document.querySelectorAll('#pianoFree .piano-row')].map(r => [...r.querySelectorAll('.key .kb')].map(k=>k.textContent).join(''));
  const instr = [...document.querySelectorAll('#instrumentSelect option')].map(o=>o.value);
  document.querySelector('#instrumentSelect').value = 'water-piano';
  document.querySelector('#instrumentSelect').dispatchEvent(new Event('change'));
  await audio.loadInstrument('water-piano');
  const buffers = audio.buffers.get('water-piano').size;
  pressKey(0); releaseKey(0);
  const glyphs = [...document.querySelectorAll('#pianoFree .piano-row')].map(r => [...r.querySelectorAll('.key .glyph svg')].length);
  return { map, labels, notes, rows, instr, buffers, glyphs };
})()`);
console.log(JSON.stringify(result, null, 2));
edge.kill();
process.exit(0);
