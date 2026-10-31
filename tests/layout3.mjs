// 上下布局 + 鼠标只移动位置 + 自适应测试
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9343;
const userDir = mkdtempSync(join(tmpdir(), "edge-l3-"));
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
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(900);

const out = {};
const measure = async (label) => ev(`(() => {
  const roll = document.querySelector('#editorScroll').getBoundingClientRect();
  const kb = document.querySelector('#pianoWorkbench').getBoundingClientRect();
  const hero = document.querySelector('.position-hero').getBoundingClientRect();
  return {
    label: '${label}', innerHeight, innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    fits: document.documentElement.scrollHeight <= innerHeight + 1,
    rollH: Math.round(roll.height),
    rollTop: Math.round(roll.top), rollBottom: Math.round(roll.bottom),
    kbTop: Math.round(kb.top), kbH: Math.round(kb.height),
    vertical: kb.top >= roll.bottom - 2,
    heroFont: getComputedStyle(document.querySelector('.position-hero strong')).fontSize,
    rowH: EDITOR_METRICS.rowH,
    notes: state.editor.notes.size, col: state.workbench.col,
  };
})()`);

out.at1280 = await measure("1280x860");

// 点击卷帘：只移动位置，不新增音符
const cellPoint = async (row, col) => ev(`(() => {
  const c = document.querySelector('#editorCanvas'); const r = c.getBoundingClientRect();
  const { gutter, ruler, rowH } = EDITOR_METRICS; const cellW = editorCellW();
  return { x: r.left + gutter + ${col} * cellW + cellW / 2, y: r.top + ruler + ${row} * rowH + rowH / 2 };
})()`);
let pt = await cellPoint(3, 2);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
await sleep(200);
out.afterRollClick = await ev(`({ notes: state.editor.notes.size, col: state.workbench.col, pos: document.querySelector('#wbPosition').textContent })`);

// 键盘弹奏写入当前节
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', key: 'y', bubbles: true }))`);
await sleep(100);
await ev(`document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyY', key: 'y', bubbles: true }))`);
await sleep(150);
out.afterKey = await ev(`({ notes: [...state.editor.notes], col: state.workbench.col, wbNotes: document.querySelector('#wbNotes').textContent })`);

// 右键删除该音符
pt = await cellPoint(0, 2);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "right", clickCount: 1 }, sid);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "right", clickCount: 1 }, sid);
await sleep(200);
out.afterRightClick = await ev(`({ notes: state.editor.notes.size })`);

// 回车前进 + 再弹一个和弦
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
await sleep(120);
for (const [c,k] of [["KeyY","y"],["KeyU","u"]]) {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: '${c}', key: '${k}', bubbles: true }))`);
  await sleep(70);
  await ev(`document.dispatchEvent(new KeyboardEvent('keyup', { code: '${c}', key: '${k}', bubbles: true }))`);
}
await sleep(200);
out.afterEnterChord = await ev(`({ notes: [...state.editor.notes].sort(), col: state.workbench.col })`);

// 截图（整页视口）
const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/screenshot-studio.png", Buffer.from(shot.data, "base64"));

// 自适应：1100x700 / 900x650
for (const [w,h] of [[1100,700],[900,650]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid);
  await sleep(600);
  out["at" + w] = await measure(w + "x" + h);
  const s2 = await send("Page.captureScreenshot", { format: "png" }, sid);
  writeFileSync(`D:/rea-tools/skystudio-pc/docs/layout-${w}x${h}.png`, Buffer.from(s2.data, "base64"));
}
await send("Emulation.clearDeviceMetricsOverride", {}, sid);

console.log(JSON.stringify(out, null, 2));
edge.kill();
process.exit(0);
