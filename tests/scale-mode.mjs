const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const t = list.find((x) => x.type === "page" && x.url.includes("8766"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300)); return r.result.value; };
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2500));
const out = {};
for (const mode of ["auto", "1", "1.25", "0.9"]) {
  await ev(`(() => { const s = document.querySelector('#uiScaleSelect'); s.value='${mode}'; s.dispatchEvent(new Event('change')); })()`);
  await new Promise((r) => setTimeout(r, 500));
  out[mode] = await ev(`(() => ({
    scale: window.UI_SCALE ?? null,
    h1: getComputedStyle(document.querySelector('.topbar h1')).fontSize,
    tab: getComputedStyle(document.querySelector('.mode-tabs .tab')).fontSize,
    fitsV: document.documentElement.scrollHeight <= innerHeight + 1,
    fitsH: document.documentElement.scrollWidth <= innerWidth + 1,
    stored: localStorage.getItem('skystudio-ui-scale'),
  }))()`);
}
await ev(`(() => { const s = document.querySelector('#uiScaleSelect'); s.value='auto'; s.dispatchEvent(new Event('change')); })()`);
console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
