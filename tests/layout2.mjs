// 布局/整合测试：工作室单屏、练习页乐谱库
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9341;
const userDir = mkdtempSync(join(tmpdir(), "edge-layout2-"));
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
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(900);

const out = {};
out.layout = await ev(`(() => {
  const panel = document.querySelector('#import');
  const card = document.querySelector('.studio-card');
  const canvas = document.querySelector('#editorCanvas');
  const kb = document.querySelector('#pianoWorkbench');
  return {
    innerHeight, innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    panelBottom: Math.round(panel.getBoundingClientRect().bottom + window.scrollY),
    cardHeight: Math.round(card.getBoundingClientRect().height),
    canvasHeight: canvas.getBoundingClientRect().height,
    keyboardHeight: Math.round(kb.getBoundingClientRect().height),
    hasSheetList: !!document.querySelector('#sheetList'),
    hasDropZone: !!document.querySelector('#dropZone'),
    hasWorkbenchKeyboard: !!document.querySelector('#pianoWorkbench .key'),

    practiceChips: document.querySelector('#practiceSheetList').children.length,
  };
})()`);

// 用工作台录几个音并保存
await ev(`switchTab('import')`);
await sleep(200);
const press = async (code, key) => {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${key}', bubbles: true }))`);
  await sleep(80);
  await ev(`document.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', key: '${key}', bubbles: true }))`);
};
for (const [c, k] of [["KeyY","y"],["KeyU","u"],["KeyH","h"]]) await press(c, k);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
await sleep(150);
for (const [c, k] of [["KeyJ","j"],["KeyN","n"]]) await press(c, k);
await ev(`document.querySelector('#editorName').value = '整合测试曲'; document.querySelector('#editorSave').click()`);
await sleep(400);

out.afterSave = await ev(`({ sheets: library.sheets.length, notes: library.sheets[0].notes.length, practiceChips: document.querySelector('#practiceSheetList').children.length, chips: [...document.querySelectorAll('#practiceSheetList .chip')].map(c=>c.textContent.trim()) })`);

// 切练习页截图 + 尺寸
await ev(`switchTab('practice')`);
await sleep(400);
out.practice = await ev(`({ chips: document.querySelectorAll('#practiceSheetList .chip').length, selected: document.querySelector('#practiceSheetSelect').value, notes: state.practice.notes.length, scrollHeight: document.documentElement.scrollHeight, innerHeight })`);
const shotP = await send("Page.captureScreenshot", { format: "png" }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/screenshot-practice.png", Buffer.from(shotP.data, "base64"));

// 回工作室截图（整页元素）
await ev(`switchTab('import'); document.querySelector('.topbar').style.position='static'; window.scrollTo(0,0);`);
await sleep(400);
out.importFinal = await ev(`({ scrollHeight: document.documentElement.scrollHeight, innerHeight, fits: document.documentElement.scrollHeight <= innerHeight + 2 })`);
const rect = await ev(`(() => { const c = document.querySelector('.studio-card').getBoundingClientRect(); const d = document.querySelector('.import-bottom').getBoundingClientRect(); return { x: c.left + window.scrollX, y: c.top + window.scrollY, width: c.width, height: d.bottom - c.top }; })()`);
const shotI = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...rect, scale: 1 } }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/screenshot-studio.png", Buffer.from(shotI.data, "base64"));

console.log(JSON.stringify(out, null, 2));
edge.kill();
process.exit(0);
