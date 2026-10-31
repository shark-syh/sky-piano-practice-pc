// 用 CDP 驱动 Edge headless 做端到端冒烟测试
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8766/";
const PORT = 9333;
const userDir = mkdtempSync(join(tmpdir(), "edge-e2e-"));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-extensions",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitVersion() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("edge devtools not ready");
}

const version = await waitVersion();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const target = await send("Target.createTarget", { url: BASE });
const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
const sessionId = attached.sessionId;

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + JSON.stringify(result.exceptionDetails.exception));
  return result.result.value;
};

// 等待页面就绪
for (let i = 0; i < 60; i++) {
  const ready = await evaluate("document.readyState").catch(() => "?");
  if (ready === "complete") break;
  await sleep(200);
}
await sleep(800);

const out = {};
out.title = await evaluate("document.title");
out.tabs = await evaluate("[...document.querySelectorAll('.tab')].map(b=>b.textContent)");
out.keys = await evaluate("document.querySelectorAll('#pianoFree .key').length");
out.instruments = await evaluate("[...document.querySelectorAll('#instrumentSelect option')].map(o=>o.value)");
out.builtinSheets = await evaluate("allSheets().map(s=>s.name+'/'+s.notes.length)");

// 解析器测试
out.parse = await evaluate(`(() => {
  const s = parseSheet(JSON.stringify({name:'测试曲',author:'me',bpm:120,pitchLevel:1,songNotes:[{key:'1Key0',time:0},{key:'2Key14',time:500},{key:'Key7',time:'1000'}]}), 'x.json');
  return {name:s.name, author:s.author, bpm:s.bpm, pitch:s.pitchLevel, notes:s.notes.map(n=>[n.t,n.k])};
})()`);

// 坏数据
out.parseBad = await evaluate(`(() => { try { parseSheet('not json','x'); return 'no-error'; } catch(e) { return e.message; } })()`);

// 导入 + 本地存储
out.imported = await evaluate(`(() => {
  const before = library.sheets.length;
  library.add(parseSheet(JSON.stringify({name:'导入测试',songNotes:[{key:'1Key1',time:0},{key:'1Key2',time:250}]}), 'i.json'));
  renderSheetList(); refreshPracticeOptions();
  return {before, after: library.sheets.length, stored: JSON.parse(localStorage.getItem('skystudio.pc.sheets.v1')).length};
})()`);

// 自由弹奏：按键状态 + 音色预载
out.freePlay = await evaluate(`(async () => {
  pressKey(3);
  const down = document.querySelector('#pianoFree .key[data-key="3"]').classList.contains('down');
  releaseKey(3);
  const up = !document.querySelector('#pianoFree .key[data-key="3"]').classList.contains('down');
  await audio.loadInstrument('piano');
  return {down, up, buffers: audio.buffers.get('piano').size};
})()`);

// 练习：打分模式判定
out.practice = await evaluate(`(async () => {
  switchTab('practice');
  document.querySelector('#modeSelect').value = 'score';
  const sel = document.querySelector('#practiceSheetSelect');
  sel.value = 'builtin-scale'; selectPracticeSheet('builtin-scale');
  startPractice();
  await new Promise(r=>setTimeout(r,1250));
  const notes = state.practice.notes;
  const pressAt = async (note) => {
    for (;;) {
      const t = performance.now() - state.practice.startAt;
      if (t >= note.t - 15) break;
      await new Promise(r=>setTimeout(r,10));
    }
    pressKey(note.k); releaseKey(note.k);
    await new Promise(r=>setTimeout(r,120));
  };
  await pressAt(notes[0]);
  await pressAt(notes[1]);
  const st = state.practice.stats;
  return {running: state.practice.running, sheet: state.practice.sheet.name, notes: notes.length, score: st.score, perfect: st.perfect, combo: st.combo, judged: state.practice.judged, totalMs: practiceTotalMs()};
})()`);

// 跟弹模式
out.waitMode = await evaluate(`(async () => {
  stopPractice();
  document.querySelector('#modeSelect').value = 'wait';
  selectPracticeSheet('builtin-scale');
  startPractice();
  await new Promise(r=>setTimeout(r,300));
  await new Promise(r=>setTimeout(r,1300));
  const next = state.practice.notes.find(n=>n.j===0);
  pressKey(next.k); releaseKey(next.k);
  await new Promise(r=>setTimeout(r,150));
  return {judged: state.practice.judged, score: state.practice.stats.score, running: state.practice.running};
})()`);

// 自动示范
out.demo = await evaluate(`(async () => {
  stopPractice();
  document.querySelector('#modeSelect').value = 'demo';
  selectPracticeSheet('builtin-scale');
  startPractice();
  await new Promise(r=>setTimeout(r,500));
  const running = state.practice.running;
  stopPractice();
  return {running, ctxState: audio.ctx.state};
})()`);

// 练习页截图
await evaluate("switchTab('practice'); document.querySelector('#modeSelect').value='score'; selectPracticeSheet('builtin-scale');");
await sleep(400);
const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync("D:/rea-tools/skystudio-pc/.tmp", { recursive: true });
writeFileSync("D:/rea-tools/skystudio-pc/.tmp/practice.png", Buffer.from(shot.data, "base64"));

// 导入页截图
await evaluate("switchTab('import')");
await sleep(300);
const shot2 = await send("Page.captureScreenshot", { format: "png" }, sessionId);
writeFileSync("D:/rea-tools/skystudio-pc/.tmp/import.png", Buffer.from(shot2.data, "base64"));

console.log(JSON.stringify(out, null, 2));
edge.kill();
process.exit(0);
