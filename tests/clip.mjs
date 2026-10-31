// 检测缩放后文字被裁切/重叠的元素
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = list.find((t) => t.type === "page" && t.url.includes("8766"));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400)); return r.result.value; };
await new Promise((r) => setTimeout(r, 800));

const report = {};
for (const tab of ["free", "import", "practice"]) {
  await ev(`switchTab('${tab}')`);
  await new Promise((r) => setTimeout(r, 400));
  report[tab] = await ev(`(() => {
    const clipped = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') {
        const text = (el.textContent || '').trim().slice(0, 24);
        if (text) clipped.push({ tag: el.tagName, cls: String(el.className).slice(0,32), id: el.id, text, cw: el.clientWidth, ch: el.clientHeight, sw: el.scrollWidth, sh: el.scrollHeight });
      }
      if (clipped.length > 20) break;
    }
    const fs = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).fontSize : null; };
    return {
      innerW: innerWidth, innerH: innerHeight, scale: window.UI_SCALE ?? (typeof UI_SCALE !== 'undefined' ? UI_SCALE : null),
      headerH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
      h1: fs('.topbar h1'), tab: fs('.mode-tabs .tab'), hint: fs('.hint'), status: fs('#editorStatus'),
      wbLetter: fs('#pianoWorkbench .key .kb'), pracLetter: fs('#pianoPractice .key .kb'), freeLetter: fs('#pianoFree .key .kb'),
      clipped,
    };
  })()`);
}
console.log(JSON.stringify(report, null, 2));
ws.close(); process.exit(0);
