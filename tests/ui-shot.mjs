// UI 截图 + 布局指标：node tests/ui-shot.mjs <outDir> [prefix]
// 依赖本地服务 http://127.0.0.1:8766
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9346;
const OUT = resolve(process.argv[2] || "tests/tmp/ui");
const PREFIX = process.argv[3] || "ui";
const SIZES = [
  [1280, 800],
  [1280, 860],
  [1100, 700],
  [900, 650],
];
const TABS = ["free", "import", "practice"];

mkdirSync(OUT, { recursive: true });
const userDir = mkdtempSync(join(tmpdir(), "edge-ui-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--window-size=1280,800", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) { version = await r.json(); break; }
  } catch {}
  await sleep(250);
}
if (!version) { console.error("Edge CDP 未就绪"); process.exit(1); }

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const ev = async (expression, sid) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

const target = await send("Target.createTarget", { url: "http://127.0.0.1:8766/" });
const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
const sid = attached.sessionId;
for (let i = 0; i < 80; i++) {
  try { if (await ev("document.readyState") === "complete") break; } catch {}
  await sleep(200);
}
await sleep(700);

const measure = () => ev(`(() => {
  const q = (s) => { const el = document.querySelector(s); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top) }; };
  const visibleText = [...document.body.querySelectorAll('*')]
    .filter((el) => el.childElementCount === 0 && el.textContent.trim() && getComputedStyle(el).visibility !== 'hidden' && el.offsetParent !== null)
    .map((el) => el.textContent.trim());
  return {
    vw: innerWidth, vh: innerHeight,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    overflowY: document.documentElement.scrollHeight > innerHeight + 1,
    panel: q('main > .panel.active'), topbar: q('.topbar'),
    freeStage: q('#freeStage'), freeKb: q('#pianoFree'),
    editorScroll: q('#editorScroll'), editorKb: q('#pianoWorkbench'),
    practiceStage: q('#practice .stage'), practiceKb: q('#pianoPractice'),
    rowH: typeof EDITOR_METRICS !== 'undefined' ? EDITOR_METRICS.rowH : null,
    keyH: (() => { const k = document.querySelector('.piano .key'); return k ? Math.round(k.getBoundingClientRect().height) : null; })(),
    textCount: visibleText.length,
    texts: visibleText,
  };
})()`, sid);

const report = {};
for (const [w, h] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid);
  await sleep(500);
  for (const tab of TABS) {
    await ev(`location.hash = '${tab}'; switchTab('${tab}');`, sid);
    await sleep(550);
    const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
    writeFileSync(join(OUT, `${PREFIX}-${tab}-${w}x${h}.png`), Buffer.from(shot.data, "base64"));
    report[`${tab}@${w}x${h}`] = await measure();
  }
}
await send("Emulation.clearDeviceMetricsOverride", {}, sid);

writeFileSync(join(OUT, `${PREFIX}-report.json`), JSON.stringify(report, null, 2));
const summary = Object.entries(report).map(([k, v]) => `${k}: overflowX=${v.overflowX} overflowY=${v.overflowY} scroll=${v.scrollW}x${v.scrollH} texts=${v.textCount}`);
console.log(summary.join("\n"));
ws.close();
edge.kill();
process.exit(0);
