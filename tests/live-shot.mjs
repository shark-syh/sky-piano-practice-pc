// 通过真实窗口的 CDP 端口截图 + 读取布局指标
import { writeFileSync } from "node:fs";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = list.find((t) => t.type === "page" && t.url.includes("8766"));
if (!target) { console.error("no target"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300)); return r.result.value; };

await send("Page.navigate", { url: "http://127.0.0.1:8766/" });
await new Promise((r) => setTimeout(r, 2500));

const metrics = await ev(`(() => {
  const q = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) }; };
  return {
    innerWidth, innerHeight, dpr: devicePixelRatio,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    main: q('main'), panel: q('#free'), stage: q('#freeStage'), keyboard: q('#pianoFree'),
    editScroll: q('#editorScroll'), workbenchKb: q('#pianoWorkbench'),
    theme: getComputedStyle(document.body).backgroundColor,
  };
})()`);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("D:/rea-tools/skystudio-pc/docs/live-window.png", Buffer.from(shot.data, "base64"));
console.log(JSON.stringify(metrics, null, 2));
ws.close();
process.exit(0);
