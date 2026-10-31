// 工作台（步进录入）端到端测试
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9340;
const userDir = mkdtempSync(join(tmpdir(), "edge-wb-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--window-size=1280,1200",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
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
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(800);

const press = async (code, key) => {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${key}', bubbles: true }))`);
  await sleep(90);
  await ev(`document.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', key: '${key}', bubbles: true }))`);
  await sleep(40);
};
const pressEnter = async () => {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
  await sleep(120);
};
const pressBackspace = async () => {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true }))`);
  await sleep(120);
};
const snap = async (label) => {
  const r = await ev(`({ label: '${label}', col: state.workbench.col, pos: document.querySelector('#wbPosition').textContent, wbNotes: document.querySelector('#wbNotes').textContent, notes: [...state.editor.notes].sort(), status: document.querySelector('#editorStatus').textContent })`);
  return r;
};

const out = {};
out.init = await snap("init");

// 第 1 拍：两个音（和弦）
await press("KeyY", "y");
await press("KeyU", "u");
out.chord0 = await snap("chord0");

// 回车 → 第 2 拍
await pressEnter();
out.afterEnter = await snap("afterEnter");

// 第 2 拍：一个音
await press("KeyH", "h");
out.noteAtBeat2 = await snap("noteAtBeat2");

// 回车步进改为「1 小节」，再回车
await ev(`const s=document.querySelector('#wbStep'); s.value='bar'; s.dispatchEvent(new Event('change'));`);
await pressEnter();
out.afterBarEnter = await snap("afterBarEnter");

// 撤销
await pressBackspace();
out.afterUndo = await snap("afterUndo");

// 输入框内按回车不应前进
await ev(`document.querySelector('#wbName').focus()`);
const before = await ev(`state.workbench.col`);
await ev(`document.querySelector('#wbName').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
await sleep(120);
out.inputEnter = { before, after: await ev(`state.workbench.col`) };

// 保存
await ev(`document.querySelector('#wbName').value = '工作台测试曲'; document.querySelector('#wbSave').click()`);
await sleep(400);
out.saved = await ev(`(() => {
  const s = library.sheets[0];
  return { sheets: library.sheets.length, name: s.name, author: s.author, bpm: s.bpm, notes: s.notes,
    stored: JSON.parse(localStorage.getItem('skystudio.pc.sheets.v1') || '[]').length,
    practiceOption: [...document.querySelectorAll('#practiceSheetSelect option')].map(o => o.textContent).slice(0, 2) };
})()`);

// 截图（编辑器 + 工作台）
await ev(`document.querySelector('.topbar').style.position = 'static'; document.querySelector('.editor-card').scrollIntoView({ block: 'start' });`);
await sleep(400);
const rect = await ev(`(() => {
  const a = document.querySelector('.editor-card').getBoundingClientRect();
  const b = document.querySelector('.workbench-card').getBoundingClientRect();
  return { x: a.left + window.scrollX, y: a.top + window.scrollY, width: a.width, height: (b.bottom - a.top) };
})()`);
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...rect, scale: 1 } }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/screenshot-workbench.png", Buffer.from(shot.data, "base64"));

console.log(JSON.stringify(out, null, 2));
edge.kill();
process.exit(0);
