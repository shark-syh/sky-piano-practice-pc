// 通过真实应用窗口（CDP :9222）截图 + 布局指标
// node tests/ui-live.mjs <outDir> [prefix]
// 注意：会用 Emulation 临时改变视口尺寸，结束后自动恢复
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8766"));
if (!page) { console.error("未找到应用窗口（:9222）"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.reload", { ignoreCache: true });
for (let i = 0; i < 80; i++) {
  try { if (await ev("document.readyState") === "complete") break; } catch {}
  await sleep(150);
}
await sleep(900);

const measure = () => ev(`(() => {
  const q = (s) => { const el = document.querySelector(s); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom) }; };
  const visibleText = [...document.body.querySelectorAll('*')]
    .filter((el) => el.childElementCount === 0 && el.textContent.trim()
      && getComputedStyle(el).visibility !== 'hidden'
      && getComputedStyle(el).display !== 'none'
      && el.getClientRects().length > 0
      && !/^(SCRIPT|STYLE|OPTION)$/.test(el.tagName))
    .map((el) => el.textContent.trim().replace(/\\s+/g, ' '));
  return {
    title: document.title, vw: innerWidth, vh: innerHeight,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    overflowY: document.documentElement.scrollHeight > innerHeight + 1,
    panel: q('main > .panel.active'), topbar: q('.topbar'),
    freeStage: q('#freeStage'), freeKb: q('#pianoFree'),
    editorScroll: q('#editorScroll'), editorKb: q('#pianoWorkbench'),
    practiceStage: q('#practice .stage'), practiceKb: q('#pianoPractice'), stats: q('.stats'),
    rowH: typeof EDITOR_METRICS !== 'undefined' ? EDITOR_METRICS.rowH : null,
    keyH: (() => { const k = document.querySelector('.piano .key'); return k ? Math.round(k.getBoundingClientRect().height) : null; })(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    panelBg: (() => { const p = document.querySelector('main > .panel.active'); return p ? getComputedStyle(p).backgroundColor : null; })(),
    textCount: visibleText.length,
    texts: visibleText,
  };
})()`);

const report = {};
for (const [w, h] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(450);
  for (const tab of TABS) {
    await ev(`switchTab('${tab}')`);
    await sleep(500);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, `${PREFIX}-${tab}-${w}x${h}.png`), Buffer.from(shot.data, "base64"));
    report[`${tab}@${w}x${h}`] = await measure();
  }
}
await send("Emulation.clearDeviceMetricsOverride");
await ev(`switchTab('free')`);

writeFileSync(join(OUT, `${PREFIX}-report.json`), JSON.stringify(report, null, 2));
console.log(Object.entries(report).map(([k, v]) =>
  `${k}: overflow=${v.overflowX ? "X" : "-"}${v.overflowY ? "Y" : "-"} scroll=${v.scrollW}x${v.scrollH} keyH=${v.keyH} rowH=${v.rowH} texts=${v.textCount}`
).join("\n"));
ws.close();
process.exit(0);
