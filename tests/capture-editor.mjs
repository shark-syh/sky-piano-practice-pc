import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9339;
const userDir = mkdtempSync(join(tmpdir(), "edge-cap-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--window-size=1280,1000",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
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
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(() => "?" ) === "complete") break; await sleep(200); }
await sleep(900);

// 构造一段示例旋律（按 BPM 100 / 4 拍每小节 / 半拍分格；同一列两个音=和弦）
await ev(`(() => {
  state.editor.bpm = 100; state.editor.beats = 4; state.editor.subdiv = 2; state.editor.bars = 4;
  const bpm = document.querySelector('#editorBpm'); bpm.value = '100';
  const beats = document.querySelector('#editorBeats'); beats.value = '4';
  const bars = document.querySelector('#editorBars'); bars.value = '4';
  const cells = [
    [0,0],[2,0],[4,1],[6,1],[8,2],[10,2],[12,3],
    [1,4],[3,4],[5,5],[7,5],[9,6],[11,6],[13,7],
    [4,8],[6,8],[8,9],[10,9],[12,10],[2,12],[4,12],[6,13],[8,14],[10,15],
  ];
  for (const [r,c] of cells) state.editor.notes.add(r + ':' + c);
  updateEditorStatus(); renderEditor();
  document.querySelector('.editor-card').scrollIntoView({ block: 'start' });
})()`);
await sleep(500);
const rect = await ev(`(() => { const r = document.querySelector('.editor-card').getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }; })()`);
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...rect, scale: 1 } }, sid);
writeFileSync("D:/rea-tools/skystudio-pc/docs/screenshot-editor.png", Buffer.from(shot.data, "base64"));
console.log("saved", rect);
edge.kill();
process.exit(0);
