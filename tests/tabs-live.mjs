// 最大窗口下三个页面适配检查（真实窗口）
import { writeFileSync } from "node:fs";
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = list.find((t) => t.type === "page" && t.url.includes("8766"));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400)); return r.result.value; };
await new Promise((r) => setTimeout(r, 1000));
const out = [];
for (const tab of ["free", "import", "practice"]) {
  await ev(`switchTab('${tab}')`);
  await new Promise((r) => setTimeout(r, 500));
  const m = await ev(`(() => ({
    tab: '${tab}', innerWidth, innerHeight, scale: (typeof UI_SCALE !== 'undefined' ? UI_SCALE : null),
    scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth,
    fitsV: document.documentElement.scrollHeight <= innerHeight + 1,
    fitsH: document.documentElement.scrollWidth <= innerWidth + 1,
    panelFits: (() => { const p = document.querySelector('#${tab}'); return p.scrollHeight <= p.clientHeight + 1; })(),
    h1: getComputedStyle(document.querySelector('.topbar h1')).fontSize,
  }))()`);
  out.push(m);
  if (tab !== "free") {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`D:/rea-tools/skystudio-pc/docs/live-${tab}.png`, Buffer.from(shot.data, "base64"));
  }
}
console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
