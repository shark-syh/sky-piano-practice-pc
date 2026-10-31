// 三个页面在多种窗口尺寸下的适配检查 + 截图
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9346;
const userDir = mkdtempSync(join(tmpdir(), "edge-hdr-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--window-size=1280,860",`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDir}`,"about:blank"], { stdio: "ignore" });
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
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400)); return r.result.value; };
for (let i = 0; i < 80; i++) { if (await ev("document.readyState").catch(()=>"?") === "complete") break; await sleep(200); }
await sleep(900);

const out = { sizes: [] };
for (const [w,h] of [[1280,860],[1024,640],[900,650],[850,560]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid);
  await sleep(500);
  for (const tab of ["free","import","practice"]) {
    await ev(`switchTab('${tab}')`);
    await sleep(350);
    const m = await ev(`(() => {
      const panel = document.querySelector('#${tab}');
      const roll = document.querySelector('#editorScroll');
      return {
        tab: '${tab}', w: ${w}, h: ${h},
        headerH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
        innerHeight, innerWidth,
        docScrollH: document.documentElement.scrollHeight,
        docScrollW: document.documentElement.scrollWidth,
        fitsV: document.documentElement.scrollHeight <= innerHeight + 1,
        fitsH: document.documentElement.scrollWidth <= innerWidth + 1,
        panelScrollH: panel.scrollHeight, panelClientH: panel.clientHeight,
        panelFits: panel.scrollHeight <= panel.clientHeight + 1,
        rollH: roll ? Math.round(roll.getBoundingClientRect().height) : null,
        rowH: (typeof EDITOR_METRICS !== 'undefined') ? EDITOR_METRICS.rowH : null,
      };
    })()`);
    out.sizes.push(m);
    if (w === 1280) {
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      writeFileSync(`D:/rea-tools/skystudio-pc/docs/screenshot-${tab}.png`, Buffer.from(shot.data, "base64"));
    }
    if (w === 900 && (tab === "free" || tab === "practice")) {
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      writeFileSync(`D:/rea-tools/skystudio-pc/docs/layout-${tab}-900x650.png`, Buffer.from(shot.data, "base64"));
    }
  }
}
await send("Emulation.clearDeviceMetricsOverride", {}, sid);
console.log(JSON.stringify(out.sizes.filter(s => s.tab === "import" || s.w === 1280), null, 2));
edge.kill(); process.exit(0);
