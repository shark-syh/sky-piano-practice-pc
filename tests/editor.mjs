// 乐谱编辑器（钢琴卷帘）端到端测试
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9338;
const userDir = mkdtempSync(join(tmpdir(), "edge-editor-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--window-size=1280,900",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
for (let i = 0; i < 60; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(700);

const out = {};
await ev(`switchTab('import')`);
await sleep(300);
out.setup = await ev(`(() => {
  const c = document.querySelector('#editorCanvas');
  const r = c.getBoundingClientRect();
  return { canvas: !!c, w: c.width, h: c.height, rect: { left: r.left, top: r.top }, cols: editorTotalCols(), stepMs: editorStepMs(), cellW: editorCellW(), notes: state.editor.notes.size };
})()`);

const clickCell = async (row, col) => {
  const pt = await ev(`(() => {
    const c = document.querySelector('#editorCanvas');
    const r = c.getBoundingClientRect();
    const { gutter, ruler, rowH } = EDITOR_METRICS;
    const cellW = editorCellW();
    return { x: r.left + gutter + ${col} * cellW + cellW / 2, y: r.top + ruler + ${row} * rowH + rowH / 2 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
  await sleep(120);
};

// 在 col 0 放两个音（和弦），col 2 放一个音，col 4 再放一个
await clickCell(0, 0);
await clickCell(2, 0);
await clickCell(0, 2);
await clickCell(9, 4);
out.afterClicks = await ev(`({ notes: state.editor.notes.size, list: [...state.editor.notes].sort(), status: document.querySelector('#editorStatus').textContent })`);

// 再点同一个位置应删除
await clickCell(0, 0);
out.afterToggleOff = await ev(`({ notes: state.editor.notes.size, has00: state.editor.notes.has('0:0') })`);
await clickCell(0, 0); // 恢复

// 改 BPM/拍号/分格
await ev(`(() => {
  const bpm = document.querySelector('#editorBpm'); bpm.value = '120'; bpm.dispatchEvent(new Event('change'));
  const beats = document.querySelector('#editorBeats'); beats.value = '3'; beats.dispatchEvent(new Event('change'));
  const sub = document.querySelector('#editorSubdiv'); sub.value = '2'; sub.dispatchEvent(new Event('change'));
  const bars = document.querySelector('#editorBars'); bars.value = '4'; bars.dispatchEvent(new Event('change'));
})()`);
await sleep(200);
out.afterParams = await ev(`({ bpm: state.editor.bpm, beats: state.editor.beats, subdiv: state.editor.subdiv, bars: state.editor.bars, cols: editorTotalCols(), stepMs: editorStepMs() })`);

// 保存
await ev(`document.querySelector('#editorName').value = '编辑器测试曲'; document.querySelector('#editorSave').click()`);
await sleep(400);
out.saved = await ev(`(() => {
  const s = library.sheets[0];
  return { sheets: library.sheets.length, name: s.name, author: s.author, bpm: s.bpm, notes: s.notes,
    stored: JSON.parse(localStorage.getItem('skystudio.pc.sheets.v1') || '[]').length,
    practiceOption: [...document.querySelectorAll('#practiceSheetSelect option')].map(o => o.textContent).slice(0, 2),
    practiceNotes: state.practice.notes.length };
})()`);

// 试听（不阻塞）
await ev(`document.querySelector('#editorPlay').click()`);
await sleep(300);
out.preview = await ev(`({ playing: state.editor.playing, playhead: state.editor.playhead })`);

// 清空
await ev(`document.querySelector('#editorClear').click()`);
out.cleared = await ev(`({ notes: state.editor.notes.size, status: document.querySelector('#editorStatus').textContent })`);

// 截图导入页（先放几个音展示）
for (const [r, c] of [[0,0],[2,0],[4,0],[1,2],[3,2],[6,4],[8,4],[10,4],[5,6],[7,8],[9,10],[11,12],[13,14]]) await clickCell(r, c);
await sleep(300);
const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/screenshot-editor.png", Buffer.from(shot.data, "base64"));

// 练习页打开刚保存的
await ev(`switchTab('practice'); const sel = document.querySelector('#practiceSheetSelect'); sel.value = library.sheets[0].id; selectPracticeSheet(sel.value);`);
await sleep(300);
out.practiceOpen = await ev(`({ sheet: state.practice.sheet && state.practice.sheet.name, notes: state.practice.notes.length, msg: document.querySelector('#stageMsg').textContent })`);

console.log(JSON.stringify(out, null, 2));
edge.kill();
process.exit(0);
