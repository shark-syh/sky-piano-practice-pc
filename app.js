/* Sky Studio PC — 导入乐谱 / 练习乐谱 / 自由弹奏
 * 音色样本来自 Sky Studio APK 的 assets/Instruments（PCM 16-bit mono 44.1kHz）
 */
"use strict";

/* 全局 UI 缩放：随窗口尺寸放大字体/图形（基准 1280×800） */
let UI_SCALE = 1;
let UI_SCALE_MODE = "auto";
const uiPx = (n) => `${Math.max(8, Math.round(n * UI_SCALE))}px`;
function applyUiScale() {
  UI_SCALE =
    UI_SCALE_MODE === "auto"
      ? clamp(Math.min(window.innerWidth / 1280, window.innerHeight / 800), 0.85, 1.5)
      : clamp(parseFloat(UI_SCALE_MODE) || 1, 0.75, 2);
  const select = $("#uiScaleSelect");
  if (select && select.value !== UI_SCALE_MODE) select.value = UI_SCALE_MODE;
  document.documentElement.style.setProperty("--ui-scale", String(UI_SCALE));
  if (typeof fitEditor === "function") fitEditor();
  if (typeof drawRoll === "function") drawRoll();
  if (typeof drawFreeRoll === "function") drawFreeRoll();
}

/* ------------------------------------------------------------------ */
/* 基础数据                                                            */
/* ------------------------------------------------------------------ */

const INSTRUMENTS = [
  { id: "piano", name: "钢琴" },
  { id: "water-piano", name: "水钢琴" },
];

// 游戏内 15 键布局：3 排 × 5 键，索引 0-14 与音色采样顺序一致（C 大调跨两个八度）
// 复刻自游戏内真实按键：Y U I O P / H J K L ; / N M , . /
// glyph: d=菱形, c=圆形, dc=菱形内含圆（按原版每个位置还原）
const ROWS = [
  {
    keys: ["KeyY", "KeyU", "KeyI", "KeyO", "KeyP"],
    labels: ["Y", "U", "I", "O", "P"],
    notes: ["C", "D", "E", "F", "G"],
    glyphs: ["dc", "d", "c", "d", "c"],
    from: 0,
  },
  {
    keys: ["KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"],
    labels: ["H", "J", "K", "L", ";"],
    notes: ["A", "B", "C", "D", "E"],
    glyphs: ["c", "d", "dc", "d", "c"],
    from: 5,
  },
  {
    keys: ["KeyN", "KeyM", "Comma", "Period", "Slash"],
    labels: ["N", "M", ",", ".", "/"],
    notes: ["F", "G", "A", "B", "C"],
    glyphs: ["c", "d", "c", "d", "dc"],
    from: 10,
  },
];

const KEY_LABELS = [];
const NOTE_LETTERS = [];
const KEY_GLYPHS = [];
for (const row of ROWS) {
  for (let i = 0; i < 5; i++) {
    KEY_LABELS[row.from + i] = row.labels[i];
    NOTE_LETTERS[row.from + i] = row.notes[i];
    KEY_GLYPHS[row.from + i] = row.glyphs[i];
  }
}

const STORAGE_KEY = "skystudio.pc.sheets.v1";
const PREFS_KEY = "skystudio.pc.prefs.v1";

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

let toastTimer = 0;
function toast(message, bad = false) {
  let node = $(".toast");
  if (!node) {
    node = el("div", "toast");
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.toggle("bad", bad);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* 音频引擎                                                            */
/* ------------------------------------------------------------------ */

const audio = {
  ctx: null,
  master: null,
  buffers: new Map(), // instId -> Map(keyIndex -> AudioBuffer)
  loading: null,
  instrument: "piano",
  volume: 0.75,

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  },

  async resume() {
    this.ensure();
    if (this.ctx.state !== "running") await this.ctx.resume();
    updateAudioButton();
  },

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
    savePrefs();
  },

  async loadInstrument(instId) {
    if (this.buffers.has(instId)) return this.buffers.get(instId);
    if (this.loading) await this.loading;
    const ctx = this.ensure();
    this.loading = (async () => {
      const map = new Map();
      const jobs = [];
      for (let i = 0; i < 15; i++) {
        jobs.push(
          fetch(`assets/instruments/${instId}/${i}.wav`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((buf) => new Promise((resolve, reject) => {
              ctx.decodeAudioData(buf, (decoded) => { map.set(i, decoded); resolve(); }, reject);
            }))
            .catch((err) => { console.warn(`sample ${instId}/${i} 加载失败`, err); })
        );
      }
      await Promise.all(jobs);
      this.buffers.set(instId, map);
      return map;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  },

  /** 立即播放一个音 */
  play(instId, keyIndex, { gain = 1, rate = 1, when = 0 } = {}) {
    const ctx = this.ensure();
    const map = this.buffers.get(instId);
    const buffer = map && map.get(keyIndex);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(when ? when : ctx.currentTime);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch {} };
  },

  /** 预取音色（切换乐器时调用） */
  prefetch(instId) {
    this.loadInstrument(instId).catch((err) => toast(`音色加载失败：${err.message}`, true));
  },
};

function updateAudioButton() {
  const btn = $("#audioEnable");
  if (!btn) return;
  const running = audio.ctx && audio.ctx.state === "running";
  btn.textContent = running ? "声音已启用" : "启用声音";
  btn.classList.toggle("accent", !running);
}

/* ------------------------------------------------------------------ */
/* 乐谱解析                                                            */
/* ------------------------------------------------------------------ */

/** 解析 Sky Studio / SkyMusic 导出的 JSON：{ name, author, bpm, pitchLevel, songNotes:[{key,time}] } */
function parseSheet(rawText, fileName = "未命名") {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("不是有效的 JSON 文本（请从 Sky Studio / SkyMusic 编辑器导出）");
  }
  if (Array.isArray(data)) data = data[0];
  if (!data || typeof data !== "object") throw new Error("乐谱根节点必须是对象");
  const notesRaw = data.songNotes;
  if (!Array.isArray(notesRaw)) throw new Error("缺少 songNotes 数组");

  const notes = [];
  let badKeys = 0;
  notesRaw.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const time = Number(typeof raw.time === "string" ? raw.time.trim() : raw.time);
    const keyText = String(raw.key ?? "");
    const m = /^(?:([123]))?Key(\d+)$/.exec(keyText);
    if (!isFinite(time) || time < 0 || !m) { badKeys++; return; }
    const keyIndex = Number(m[2]);
    if (keyIndex < 0 || keyIndex > 14) { badKeys++; return; }
    notes.push({ t: time, k: keyIndex, j: -1 });
  });
  if (!notes.length) throw new Error("songNotes 里没有可识别的音符（key 需要形如 1Key0 / Key14）");

  notes.sort((a, b) => a.t - b.t);
  const name = (typeof data.name === "string" && data.name.trim()) || fileName.replace(/\.[^.]+$/, "");
  const author = typeof data.author === "string" ? data.author : "";
  const bpm = Number(data.bpm) > 0 ? Number(data.bpm) : 0;
  const pitchLevel = clamp(Number(data.pitchLevel) || 0, -2, 2);
  return { name, author, bpm, pitchLevel, notes, badKeys };
}

/* ------------------------------------------------------------------ */
/* 乐谱库                                                              */
/* ------------------------------------------------------------------ */

const library = {
  sheets: [],

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.sheets = raw ? JSON.parse(raw) : [];
    } catch {
      this.sheets = [];
    }
    if (!Array.isArray(this.sheets)) this.sheets = [];
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sheets));
    } catch {
      toast("本地存储空间不足，乐谱只在本次会话有效", true);
    }
  },

  add(sheet) {
    const id = `s${Date.now()}${Math.floor(Math.random() * 1000)}`;
    this.sheets.unshift({ id, ...sheet });
    this.save();
    return id;
  },

  remove(id) {
    this.sheets = this.sheets.filter((s) => s.id !== id);
    this.save();
  },

  byId(id) {
    return this.sheets.find((s) => s.id === id);
  },
};

/* 内置示例（无需导入即可试用） */
function builtinSheets() {
  const seq = (pairs) => {
    let t = 0;
    return pairs.map(([key, gap]) => {
      const note = { t, k: key, j: -1 };
      t += gap;
      return note;
    });
  };
  return [
    {
      id: "builtin-scale",
      name: "示例 · 十五键音阶",
      author: "内置",
      bpm: 90,
      pitchLevel: 0,
      builtin: true,
      notes: seq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((k) => [k, 380])),
    },
    {
      id: "builtin-chord",
      name: "示例 · 和弦练习",
      author: "内置",
      bpm: 80,
      pitchLevel: 0,
      builtin: true,
      notes: (() => {
        const out = [];
        const chords = [[0, 2, 4], [5, 7, 9], [10, 12, 14], [5, 7, 9], [0, 2, 4], [10, 12, 14]];
        let t = 0;
        for (const chord of chords) {
          for (const k of chord) out.push({ t, k, j: -1 });
          out.push({ t: t + 90, k: chord[0], j: -1 });
          t += 900;
        }
        return out.sort((a, b) => a.t - b.t);
      })(),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 应用状态                                                            */
/* ------------------------------------------------------------------ */

const state = {
  tab: "free",
  instrument: "piano",
  pitch: 0,
  pressed: new Set(),
  practice: {
    sheet: null,
    mode: "score",
    speed: 1,
    running: false,
    startAt: 0,       // performance.now() 基准
    pausedAt: 0,
    notes: [],
    judged: 0,
    stats: null,
    lastFrame: 0,
    flash: new Map(), // keyIndex -> 剩余闪烁
  },
};

const PREFS = { instrument: "piano", volume: 0.75, pitch: 0 };

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (INSTRUMENTS.some((i) => i.id === p.instrument)) {
      state.instrument = p.instrument;
      audio.instrument = p.instrument;
    }
    if (typeof p.volume === "number") {
      state.volume = clamp(p.volume, 0, 1);
      audio.volume = state.volume;
    }
    if (typeof p.pitch === "number") state.pitch = clamp(p.pitch, -2, 2);
  } catch {}
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ instrument: state.instrument, volume: audio.volume, pitch: state.pitch }));
  } catch {}
}

/* ------------------------------------------------------------------ */
/* 键盘 / 琴键 UI                                                      */
/* ------------------------------------------------------------------ */

/** 生成原版音符图形：菱形 / 圆 / 菱形内含圆 */
function glyphMarkup(kind) {
  const diamond = '<path d="M12 2.4 21.6 12 12 21.6 2.4 12Z"/>';
  const circle = '<circle cx="12" cy="12" r="6.6"/>';
  const inner = '<circle cx="12" cy="12" r="3"/>';
  const parts = kind === "d" ? diamond : kind === "c" ? circle : diamond + inner;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${parts}</svg>`;
}

function buildPianos() {
  for (const selector of ["#pianoFree", "#pianoPractice", "#pianoWorkbench"]) {
    const host = $(selector);
    if (!host) continue;
    host.innerHTML = "";
    for (const row of ROWS) {
      const rowNode = el("div", "piano-row");
      for (let i = 0; i < 5; i++) {
        const keyIndex = row.from + i;
        const key = el("button", "key");
        key.type = "button";
        key.dataset.key = String(keyIndex);
        const glyph = el("span", "glyph");
        glyph.innerHTML = glyphMarkup(KEY_GLYPHS[keyIndex]);
        const kb = el("span", "kb", KEY_LABELS[keyIndex]);
        const note = el("span", "idx", NOTE_LETTERS[keyIndex]);
        key.append(glyph, kb, note);
        key.addEventListener("pointerdown", (e) => { e.preventDefault(); pressKey(keyIndex, true); });
        key.addEventListener("pointerup", () => releaseKey(keyIndex, true));
        key.addEventListener("pointerleave", () => releaseKey(keyIndex, true));
        rowNode.append(key);
      }
      host.append(rowNode);
    }
  }
}

function keyNode(keyIndex) {
  return document.querySelector(`#pianoFree .key[data-key="${keyIndex}"], #pianoPractice .key[data-key="${keyIndex}"]`);
}

function updateKeyVisual(keyIndex, down) {
  for (const host of ["#pianoFree", "#pianoPractice", "#pianoWorkbench"]) {
    const node = document.querySelector(`${host} .key[data-key="${keyIndex}"]`);
    if (node) node.classList.toggle("down", down);
  }
}

function noteLabel(keyIndex) {
  return `${NOTE_LETTERS[keyIndex]}（${KEY_LABELS[keyIndex]} 键）`;
}

function pressKey(keyIndex, fromPointer = false) {
  if (keyIndex < 0 || keyIndex > 14) return;
  if (state.pressed.has(keyIndex)) return;
  state.pressed.add(keyIndex);
  updateKeyVisual(keyIndex, true);

  const pitch = state.tab === "practice"
    ? (state.practice.sheet ? state.practice.sheet.pitchLevel + state.pitch : state.pitch)
    : state.pitch;
  const rate = Math.pow(2, pitch);
  audio.play(state.instrument, keyIndex, { rate });

  if (state.tab === "import") wbAddNote(keyIndex);

  if (state.tab === "free") {
    recordFreeNote(keyIndex);
    $("#nowPlaying").innerHTML = `正在弹奏：<b>${noteLabel(keyIndex)}</b>`;
  }
  if (state.practice.running && (state.practice.mode === "score" || state.practice.mode === "wait")) {
    handleUserHit(keyIndex, performance.now());
  }
}

function releaseKey(keyIndex, fromPointer = false) {
  if (!state.pressed.has(keyIndex)) return;
  state.pressed.delete(keyIndex);
  updateKeyVisual(keyIndex, false);
}

const KEY_TO_INDEX = new Map();
for (const row of ROWS) for (let i = 0; i < 5; i++) KEY_TO_INDEX.set(row.keys[i], row.from + i);

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (state.tab === "import" && e.key === "Enter") { e.preventDefault(); wbAdvance(); return; }
  if (state.tab === "import" && e.key === "Backspace") { e.preventDefault(); wbUndo(); return; }
  const keyIndex = KEY_TO_INDEX.get(e.code);
  if (keyIndex === undefined) return;
  e.preventDefault();
  pressKey(keyIndex);
});

document.addEventListener("keyup", (e) => {
  const keyIndex = KEY_TO_INDEX.get(e.code);
  if (keyIndex === undefined) return;
  releaseKey(keyIndex);
});

/* ------------------------------------------------------------------ */
/* 标签页                                                              */
/* ------------------------------------------------------------------ */

function switchTab(name) {
  if (state.practice.running && name !== "practice") stopPractice();

  state.tab = name;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
  if (name === "practice") { refreshPracticeOptions(); requestAnimationFrame(fitPracticeCanvas); }
  if (name === "free") requestAnimationFrame(fitFreeCanvas);
  requestAnimationFrame(applyUiScale);
  if (name === "import") { wbUpdateUI(); requestAnimationFrame(fitEditor); }
}

/* ------------------------------------------------------------------ */
/* 乐谱库 UI                                                           */
/* ------------------------------------------------------------------ */

function renderSheetList() {
  const host = $("#practiceSheetList");
  if (!host) return;
  host.innerHTML = "";
  const select = $("#practiceSheetSelect");
  const current = select ? select.value : "";
  const sheets = [...library.sheets, ...builtinSheets()];
  if (!sheets.length) {
    host.append(el("span", "hint", "还没有乐谱：去「乐谱工作室」录一首，或导入 .json"));
    return;
  }
  for (const sheet of sheets) {
    const recorded = !sheet.builtin && ["本机录入", "工作台", "编辑器"].includes(sheet.author);
    const chip = el("button", "chip" + (sheet.id === current ? " active" : ""));
    chip.type = "button";
    chip.title = `${sheet.name} · ${sheet.notes.length} 个音符${sheet.author ? ` · ${sheet.author}` : ""}`;
    chip.append(
      el("span", "chip-name", `${sheet.name}${sheet.builtin ? "（内置）" : recorded ? "（记忆）" : ""}`),
      el("span", "chip-count", String(sheet.notes.length)),
    );
    chip.addEventListener("click", () => {
      const sel = $("#practiceSheetSelect");
      if (!sel) return;
      sel.value = sheet.id;
      selectPracticeSheet(sheet.id);
      renderSheetList();
    });
    host.append(chip);
  }
}
function allSheets() {
  return [...library.sheets, ...builtinSheets()];
}

function sheetById(id) {
  return library.byId(id) || builtinSheets().find((s) => s.id === id) || null;
}

async function importFiles(files) {
  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = parseSheet(text, file.name);
      library.add(parsed);
      ok++;
      if (parsed.badKeys) toast(`${file.name}：${parsed.badKeys} 个音符无法识别，已跳过`);
    } catch (err) {
      failed++;
      toast(`${file.name} 导入失败：${err.message}`, true);
    }
  }
  if (ok) {
    renderSheetList();
    refreshPracticeOptions();
    toast(`已导入 ${ok} 个乐谱${failed ? `（${failed} 个失败）` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* 工作台（步进录入：把音符喂给上方钢琴卷帘）                          */
/* ------------------------------------------------------------------ */

state.workbench = { col: 0, step: "beat", history: [] };

function wbMaxCol() {
  return Math.max(0, editorTotalCols() - 1);
}

function wbCurrentCol() {
  return clamp(state.workbench.col, 0, wbMaxCol());
}

function wbStepCols() {
  const ed = state.editor;
  if (state.workbench.step === "grid") return 1;
  if (state.workbench.step === "bar") return Math.max(1, ed.beats * ed.subdiv);
  return Math.max(1, ed.subdiv);
}

function wbSnapshot() {
  return { notes: new Set(state.editor.notes), col: wbCurrentCol() };
}

function wbPushHistory() {
  const h = state.workbench.history;
  h.push(wbSnapshot());
  if (h.length > 200) h.shift();
}

function wbPositionText() {
  const ed = state.editor;
  const col = wbCurrentCol();
  const colsPerBar = Math.max(1, ed.beats * ed.subdiv);
  const bar = Math.floor(col / colsPerBar) + 1;
  const rem = col % colsPerBar;
  const beat = Math.floor(rem / Math.max(1, ed.subdiv)) + 1;
  const grid = (rem % Math.max(1, ed.subdiv)) + 1;
  return `第 ${bar} 小节 · 第 ${beat} 拍 · 第 ${grid} 格`;
}

function wbUpdateUI() {
  const pos = $("#wbPosition");
  if (pos) pos.textContent = wbPositionText();
  const info = $("#wbNotes");
  if (info) {
    const col = wbCurrentCol();
    const rows = [...state.editor.notes]
      .filter((k) => Number(k.split(":")[1]) === col)
      .map((k) => Number(k.split(":")[0]))
      .sort((a, b) => a - b);
    info.innerHTML = rows.length
      ? `当前音符：<b>${rows.map((r) => `${NOTE_LETTERS[r]}(${KEY_LABELS[r]})`).join(" + ")}</b>`
      : "当前音符：—（弹奏或点上方格子录入）";
  }
  renderEditor();
}

function wbMove(delta) {
  const ed = state.editor;
  const target = wbCurrentCol() + delta;
  if (target < 0) { state.workbench.col = 0; wbUpdateUI(); return; }
  if (target > wbMaxCol() && ed.bars < 64) {
    ed.bars += 1;
    const bars = $("#editorBars");
    if (bars) bars.value = String(ed.bars);
    updateEditorStatus();
  }
  state.workbench.col = clamp(target, 0, wbMaxCol());
  wbUpdateUI();
}

function wbAdvance() { wbPushHistory(); wbMove(wbStepCols()); }
function wbPrev() { wbPushHistory(); wbMove(-wbStepCols()); }

function wbAddNote(row) {
  const col = wbCurrentCol();
  const key = `${row}:${col}`;
  const ed = state.editor;
  if (ed.notes.has(key)) return;
  wbPushHistory();
  ed.notes.add(key);
  updateEditorStatus();
  wbUpdateUI();
}

function wbUndo() {
  const snap = state.workbench.history.pop();
  if (!snap) { toast("没有可撤销的操作", true); return; }
  state.editor.notes = new Set(snap.notes);
  state.workbench.col = snap.col;
  updateEditorStatus();
  wbUpdateUI();
}

function wbClear() {
  if (!state.editor.notes.size) return;
  wbPushHistory();
  state.editor.notes.clear();
  state.workbench.col = 0;
  updateEditorStatus();
  wbUpdateUI();
  toast("已清空工作台与卷帘");
}

function wbInit() {
  const step = $("#wbStep");
  if (step) step.addEventListener("change", () => { state.workbench.step = step.value; });
  const prev = $("#wbPrev"); if (prev) prev.addEventListener("click", wbPrev);
  const next = $("#wbNext"); if (next) next.addEventListener("click", wbAdvance);
  const undo = $("#wbUndo"); if (undo) undo.addEventListener("click", wbUndo);
  wbUpdateUI();
}

/** 导出为 Sky Studio 乐谱 JSON 文件 */
function exportSheet(sheet) {
  const data = {
    name: sheet.name,
    author: sheet.author || "",
    bpm: sheet.bpm || 100,
    bitsPerPage: 16,
    pitchLevel: sheet.pitchLevel || 0,
    isComposed: !!(sheet.isComposed || sheet.author === "本机录入"),
    songNotes: sheet.notes.map((n) => ({ key: `1Key${n.k}`, time: n.t })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${String(sheet.name).replace(/[\\/:*?"<>|]/g, "_")}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`已导出 ${a.download}`);
}

/* ------------------------------------------------------------------ */
/* 乐谱编辑器（钢琴卷帘）                                              */
/* ------------------------------------------------------------------ */

const EDITOR_METRICS = { gutter: 56, ruler: 20, rowH: 14, pxPerBeat: 48 };

state.editor = {
  bpm: 100,
  beats: 4,
  subdiv: 2,
  bars: 8,
  notes: new Set(), // "row:col"
  playhead: null,
  playing: false,
};

function editorStepMs() {
  return 60000 / Math.max(30, state.editor.bpm) / Math.max(1, state.editor.subdiv);
}

function editorTotalCols() {
  return Math.max(1, state.editor.bars * state.editor.beats * state.editor.subdiv);
}

function editorCellW() {
  return EDITOR_METRICS.pxPerBeat / Math.max(1, state.editor.subdiv);
}

function editorClampParams() {
  const ed = state.editor;
  ed.bpm = clamp(parseInt($("#editorBpm").value, 10) || 100, 30, 300);
  ed.beats = clamp(parseInt($("#editorBeats").value, 10) || 4, 2, 12);
  ed.subdiv = clamp(parseInt($("#editorSubdiv").value, 10) || 2, 1, 4);
  ed.bars = clamp(parseInt($("#editorBars").value, 10) || 8, 1, 64);
  $("#editorBpm").value = String(ed.bpm);
  $("#editorBeats").value = String(ed.beats);
  $("#editorBars").value = String(ed.bars);
  const cols = editorTotalCols();
  for (const key of [...ed.notes]) {
    if (Number(key.split(":")[1]) >= cols) ed.notes.delete(key);
  }
}

function renderEditor() {
  const canvas = $("#editorCanvas");
  if (!canvas) return;
  const ed = state.editor;
  const { gutter, ruler, rowH } = EDITOR_METRICS;
  const cols = editorTotalCols();
  const cellW = editorCellW();
  const W = Math.max(320, Math.round(gutter + cols * cellW));
  const H = ruler + 15 * rowH;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const g = canvas.getContext("2d");

  g.clearRect(0, 0, W, H);
  g.fillStyle = "#0a1120";
  g.fillRect(0, 0, W, H);

  // 行底色
  for (let r = 0; r < 15; r++) {
    g.fillStyle = r % 2 ? "rgba(255,255,255,.018)" : "rgba(255,255,255,.04)";
    g.fillRect(gutter, ruler + r * rowH, W - gutter, rowH);
  }

  // 竖线：小节 / 拍 / 分格
  const colsPerBar = ed.beats * ed.subdiv;
  for (let col = 0; col <= cols; col++) {
    const x = Math.round(gutter + col * cellW) + 0.5;
    const isBar = col % colsPerBar === 0;
    const isBeat = col % ed.subdiv === 0;
    g.strokeStyle = isBar ? "rgba(140,180,235,.6)" : isBeat ? "rgba(120,160,220,.28)" : "rgba(120,160,220,.10)";
    g.lineWidth = isBar ? 1.6 : 1;
    g.beginPath(); g.moveTo(x, ruler); g.lineTo(x, H); g.stroke();
  }
  // 横线
  g.strokeStyle = "rgba(120,160,220,.18)";
  g.lineWidth = 1;
  for (let r = 0; r <= 15; r++) {
    const y = Math.round(ruler + r * rowH) + 0.5;
    g.beginPath(); g.moveTo(gutter, y); g.lineTo(W, y); g.stroke();
  }

  // 顶部小节/拍标记
  g.fillStyle = "#9fb4d8";
  g.font = `${uiPx(11)} 'Segoe UI', 'Microsoft YaHei', sans-serif`;
  g.textAlign = "left";
  for (let bar = 0; bar < ed.bars; bar++) {
    const x = gutter + bar * colsPerBar * cellW;
    g.fillText(`小节 ${bar + 1}`, x + 4, 13);
    if (cellW * ed.beats >= 56) {
      for (let b = 0; b < ed.beats; b++) {
        g.fillStyle = "rgba(159,180,216,.55)";
        g.fillText(String(b + 1), x + b * ed.subdiv * cellW + 3, 13);
        g.fillStyle = "#9fb4d8";
      }
    }
  }

  // 左侧键位栏
  g.fillStyle = "#08101e";
  g.fillRect(0, 0, gutter, H);
  g.strokeStyle = "rgba(120,160,220,.25)";
  g.beginPath(); g.moveTo(gutter - 0.5, 0); g.lineTo(gutter - 0.5, H); g.stroke();
  const keyFont = Math.round(clamp(rowH * 0.5, 9, 22));
  const noteFont = Math.round(clamp(rowH * 0.32, 8, 15));
  g.textAlign = "left";
  g.textBaseline = "middle";
  for (let r = 0; r < 15; r++) {
    const y = ruler + r * rowH + rowH / 2;
    g.fillStyle = "#dbe6fb";
    g.font = `600 ${keyFont}px ui-monospace, Consolas, monospace`;
    const keyW = g.measureText(KEY_LABELS[r]).width;
    g.fillText(KEY_LABELS[r], 7, y);
    g.fillStyle = "rgba(190,205,235,.6)";
    g.font = `${noteFont}px ui-monospace, Consolas, monospace`;
    g.fillText(NOTE_LETTERS[r], 7 + Math.max(14, keyW) + 5, y);
  }
  g.textBaseline = "alphabetic";

  // 当前工作台位置
  if (state.workbench) {
    const cursor = clamp(state.workbench.col, 0, cols - 1);
    const cx = gutter + cursor * cellW;
    g.fillStyle = "rgba(98,208,255,.10)";
    g.fillRect(cx, ruler, cellW, 15 * rowH);
    g.strokeStyle = "rgba(98,208,255,.75)";
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(cx + 0.5, ruler); g.lineTo(cx + 0.5, H); g.stroke();
    g.fillStyle = "rgba(98,208,255,.95)";
    g.beginPath();
    g.moveTo(cx + cellW / 2 - 4, ruler - 1);
    g.lineTo(cx + cellW / 2 + 4, ruler - 1);
    g.lineTo(cx + cellW / 2, ruler + 6);
    g.closePath();
    g.fill();
  }

  // 音符
  for (const key of ed.notes) {
    const [row, col] = key.split(":").map(Number);
    const x = gutter + col * cellW + 1.5;
    const y = ruler + row * rowH + 3;
    const w = Math.max(6, cellW - 3);
    const h = rowH - 6;
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "rgba(255,196,160,.92)");
    grad.addColorStop(1, "rgba(235,140,105,.88)");
    g.fillStyle = grad;
    roundRect(g, x, y, w, h, Math.min(6, w / 2));
    g.fill();
    g.strokeStyle = "rgba(255,226,210,.55)";
    g.lineWidth = 1;
    g.stroke();
  }

  // 播放头
  if (ed.playhead !== null) {
    const x = gutter + ed.playhead * cellW;
    g.strokeStyle = "rgba(98,208,255,.95)";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, ruler); g.lineTo(x, H); g.stroke();
    g.fillStyle = "rgba(98,208,255,.95)";
    g.beginPath(); g.arc(x, ruler + 4, 3, 0, Math.PI * 2); g.fill();
  }
}

function editorCellAt(event) {
  const canvas = $("#editorCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const { gutter, ruler, rowH } = EDITOR_METRICS;
  const cellW = editorCellW();
  if (x < gutter || y < ruler) return null;
  const col = Math.floor((x - gutter) / cellW);
  const row = Math.floor((y - ruler) / rowH);
  if (col < 0 || col >= editorTotalCols() || row < 0 || row > 14) return null;
  return { row, col };
}

function editorToggleCell(cell, mode) {
  if (!cell) return;
  const key = `${cell.row}:${cell.col}`;
  const ed = state.editor;
  wbPushHistory();
  if (mode === "add") ed.notes.add(key);
  else if (mode === "erase") ed.notes.delete(key);
  else if (ed.notes.has(key)) ed.notes.delete(key);
  else ed.notes.add(key);
  state.workbench.col = cell.col;
  updateEditorStatus();
  wbUpdateUI();
}

function updateEditorStatus() {
  const status = $("#editorStatus");
  if (!status) return;
  const ed = state.editor;
  const cols = new Set([...ed.notes].map((k) => k.split(":")[1]));
  status.textContent = `共 ${ed.notes.size} 个音符 · ${cols.size} 个时间点 · ${ed.bars} 小节 · ${ed.bpm} BPM`;
}

function editorPreview() {
  const ed = state.editor;
  if (ed.playing) return;
  const list = [...ed.notes].map((k) => {
    const [row, col] = k.split(":").map(Number);
    return { row, col };
  });
  if (!list.length) { toast("先放几个音符再试听", true); return; }
  audio.resume();
  audio.loadInstrument(state.instrument).then(() => {
    const step = editorStepMs();
    const ctx = audio.ensure();
    const startAt = ctx.currentTime + 0.15;
    const rate = Math.pow(2, state.pitch);
    for (const n of list) {
      audio.play(state.instrument, n.row, { when: startAt + (n.col * step) / 1000, rate });
    }
    const total = editorTotalCols() * step;
    ed.playing = true;
    ed.playStart = performance.now() + 150;
    const btn = $("#editorPlay");
    btn.textContent = "播放中…";
    btn.disabled = true;
    const tick = () => {
      const t = performance.now() - ed.playStart;
      ed.playhead = Math.max(0, t / step);
      renderEditor();
      if (t < total + 300) requestAnimationFrame(tick);
      else {
        ed.playing = false;
        ed.playhead = null;
        btn.textContent = "▶ 试听";
        btn.disabled = false;
        renderEditor();
      }
    };
    requestAnimationFrame(tick);
  });
}

function saveEditorSheet(nameText, author) {
  const ed = state.editor;
  editorClampParams();
  if (!ed.notes.size) { toast("还没有音符，先在格子里点几个", true); return; }
  const step = editorStepMs();
  const fallback = `${author} ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  const notes = [...ed.notes]
    .map((k) => {
      const [row, col] = k.split(":").map(Number);
      return { t: Math.round(col * step), k: row };
    })
    .sort((a, b) => a.t - b.t || a.k - b.k);
  const sheet = {
    name: (nameText && nameText.trim()) || fallback,
    author,
    bpm: ed.bpm,
    pitchLevel: 0,
    notes,
  };
  const id = library.add(sheet);
  renderSheetList();
  refreshPracticeOptions();
  const select = $("#practiceSheetSelect");
  if (select) { select.value = id; selectPracticeSheet(id); }
  toast(`已保存「${sheet.name}」· ${notes.length} 个音符，可在练习页打开`);
  updateEditorStatus();
  return id;
}

function editorSave() {
  const nameInput = $("#editorName");
  saveEditorSheet(nameInput ? nameInput.value : "", "编辑器");
  if (nameInput) nameInput.value = "";
}

function editorClear() {
  const ed = state.editor;
  if (!ed.notes.size) return;
  wbPushHistory();
  ed.notes.clear();
  updateEditorStatus();
  wbUpdateUI();
  toast("已清空编辑器");
}

let editorDragging = false;

/** 根据卷帘容器可用高度自适应行高 */
function fitEditor() {
  const host = $("#editorScroll");
  if (!host) return;
  const h = host.clientHeight;
  const w = host.clientWidth;
  if (!h || !w) return;
  let changed = false;
  const rowH = clamp(Math.floor((h - EDITOR_METRICS.ruler - 2) / 15), 10, 56);
  if (rowH !== EDITOR_METRICS.rowH) { EDITOR_METRICS.rowH = rowH; changed = true; }
  const beats = Math.max(1, state.editor.bars * state.editor.beats);
  const pxPerBeat = clamp((w - EDITOR_METRICS.gutter - 10) / beats, 24, 140);
  if (Math.abs(pxPerBeat - EDITOR_METRICS.pxPerBeat) > 0.5) { EDITOR_METRICS.pxPerBeat = pxPerBeat; changed = true; }
  if (changed) renderEditor();
}

function moveCursorToColumn(col) {
  state.workbench.col = clamp(col, 0, Math.max(0, editorTotalCols() - 1));
  wbUpdateUI();
}

function removeNoteAt(cell) {
  if (!cell) return;
  const key = `${cell.row}:${cell.col}`;
  if (!state.editor.notes.has(key)) return;
  wbPushHistory();
  state.editor.notes.delete(key);
  updateEditorStatus();
  wbUpdateUI();
}

function initEditor() {
  const canvas = $("#editorCanvas");
  if (!canvas) return;
  editorClampParams();
  renderEditor();
  updateEditorStatus();

  // 左键：只移动当前小节/拍位置（不再输入音符）
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const cell = editorCellAt(e);
    if (!cell) return;
    e.preventDefault();
    editorDragging = true;
    moveCursorToColumn(cell.col);
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!editorDragging || e.buttons === 0) return;
    const cell = editorCellAt(e);
    if (cell) moveCursorToColumn(cell.col);
  });
  const endDrag = () => { editorDragging = false; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointerleave", endDrag);
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    removeNoteAt(editorCellAt(e));
  });

  for (const id of ["#editorBpm", "#editorBeats", "#editorBars", "#editorSubdiv"]) {
    const node = $(id);
    if (node) node.addEventListener("change", () => { editorClampParams(); updateEditorStatus(); renderEditor(); });
  }
  $("#editorPlay").addEventListener("click", editorPreview);
  $("#editorSave").addEventListener("click", editorSave);
  $("#editorClear").addEventListener("click", editorClear);
  window.addEventListener("resize", () => { fitEditor(); fitPracticeCanvas(); fitFreeCanvas(); applyUiScale(); });
}

/* ------------------------------------------------------------------ */
/* 练习                                                                */
/* ------------------------------------------------------------------ */

function refreshPracticeOptions() {
  const select = $("#practiceSheetSelect");
  const prev = select.value;
  select.innerHTML = "";
  for (const s of allSheets()) {
    const opt = el("option", undefined, `${s.name}${s.builtin ? "（内置）" : ""} · ${s.notes.length} 音`);
    opt.value = s.id;
    select.append(opt);
  }
  if (prev && allSheets().some((s) => s.id === prev)) select.value = prev;
  selectPracticeSheet(select.value);
  renderSheetList();
}

function selectPracticeSheet(id) {
  const sheet = sheetById(id);
  const p = state.practice;
  p.sheet = sheet;
  p.notes = sheet ? sheet.notes.map((n) => ({ t: n.t, k: n.k, j: 0 })) : [];
  resetPracticeStats();
  $("#stageMsg").textContent = sheet
    ? `已选择《${sheet.name}》，点击“开始”练习`
    : "从“导入乐谱”导入文件，或选择内置示例乐谱后开始练习";
  drawRoll();
}

function resetPracticeStats() {
  const p = state.practice;
  p.stats = { score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, extra: 0, judged: 0 };
  p.judged = 0;
  p.flash = new Map();
  if (p.notes) for (const n of p.notes) n.j = 0;
  $("#statScore").textContent = "0";
  $("#statCombo").textContent = "0";
  $("#statAcc").textContent = "--";
  $("#statProgress").textContent = `0 / ${p.notes ? p.notes.length : 0}`;
  $("#judgement").textContent = "";
  $("#judgement").className = "judgement";
  $("#noteGuide").innerHTML = "目标音符会在这里高亮";
}

function setGuide(keys) {
  const host = $("#noteGuide");
  if (!keys.length) { host.innerHTML = "练习结束 🎉"; return; }
  host.innerHTML = `接下来：${keys.map((k) => `<b>${NOTE_LETTERS[k]}</b>(${KEY_LABELS[k]})`).join(" ")}`;
  document.querySelectorAll("#pianoPractice .key").forEach((node) => {
    node.classList.toggle("target", keys.includes(Number(node.dataset.key)));
  });
}

const PRE_ROLL_MS = 1200;

function startPractice() {
  const p = state.practice;
  if (!p.sheet) { toast("先选择一个乐谱", true); return; }
  audio.resume();
  audio.loadInstrument(state.instrument).then(() => {
    resetPracticeStats();
    p.mode = $("#modeSelect").value;
    p.speed = Number($("#speedSelect").value) || 1;
    p.running = true;
    p.startAt = performance.now() + PRE_ROLL_MS;
    p.lastFrame = performance.now();
    $("#startBtn").textContent = "停止";
    $("#stageMsg").textContent = "准备…";
    if (p.mode === "demo") scheduleDemo();
    requestAnimationFrame(practiceFrame);
  });
}

function stopPractice() {
  const p = state.practice;
  p.running = false;
  $("#startBtn").textContent = "开始";
  for (const node of document.querySelectorAll("#pianoPractice .key")) node.classList.remove("target");
}

function scheduleDemo() {
  const p = state.practice;
  const ctx = audio.ensure();
  const now = ctx.currentTime + PRE_ROLL_MS / 1000;
  const base = performance.now() + PRE_ROLL_MS;
  // 记录每个音符的实际播放时间，用于画面同步
  for (let i = 0; i < p.notes.length; i++) {
    const n = p.notes[i];
    const at = now + (n.t / p.speed) / 1000;
    audio.play(state.instrument, n.k, { when: at, rate: Math.pow(2, (p.sheet.pitchLevel || 0) + state.pitch) });
    n.j = -1; // 自动演奏，不参与判定
  }
  p.startAt = base;
}

function handleUserHit(keyIndex, now) {
  const p = state.practice;
  const t = (now - p.startAt) * p.speed;
  if (t < 0) return; // 前摇阶段不判定
  const window = 320;

  if (p.mode === "wait") {
    // 跟弹：只有按对当前音符才推进
    const next = p.notes.find((n) => n.j === 0);
    if (!next) return;
    if (next.k === keyIndex) {
      judgeNote(next, 0, "perfect", t);
      p.stats.score += 100;
      p.stats.perfect++;
      bumpCombo();
      p.judged++;
      flashKey(keyIndex, true);
    } else {
      p.stats.extra++;
      p.stats.combo = 0;
      $("#judgement").textContent = "✗";
      $("#judgement").className = "judgement bad";
      flashKey(keyIndex, false);
    }
    updateStats();
    return;
  }

  // 演奏打分：在窗口内找最接近的同键音符
  let best = null;
  let bestDiff = Infinity;
  for (const n of p.notes) {
    if (n.j !== 0 || n.k !== keyIndex) continue;
    const diff = Math.abs(n.t - t);
    if (diff < bestDiff) { best = n; bestDiff = diff; }
  }
  if (!best || bestDiff > window) {
    p.stats.extra++;
    p.stats.combo = 0;
    if (p.stats.extra % 3 === 1) { $("#judgement").textContent = "空键"; $("#judgement").className = "judgement bad"; }
    updateStats();
    return;
  }
  let verdict;
  let score;
  if (bestDiff <= 80) { verdict = "perfect"; score = 100; p.stats.perfect++; }
  else if (bestDiff <= 160) { verdict = "good"; score = 60; p.stats.good++; }
  else { verdict = "miss"; score = 0; p.stats.miss++; }
  judgeNote(best, bestDiff, verdict, t);
  p.stats.score += score;
  if (verdict === "miss") p.stats.combo = 0; else bumpCombo();
  p.judged++;
  flashKey(keyIndex, verdict !== "miss");
  $("#judgement").textContent = verdict === "perfect" ? "完美" : verdict === "good" ? "良好" : "偏差";
  $("#judgement").className = `judgement ${verdict === "miss" ? "bad" : "good"}`;
  updateStats();
}

function judgeNote(note, diff, verdict, t) {
  note.j = verdict === "miss" ? 2 : 1;
  note.diff = diff;
  note.hitAt = t;
}

function bumpCombo() {
  const p = state.practice;
  p.stats.combo++;
  p.stats.maxCombo = Math.max(p.stats.maxCombo, p.stats.combo);
}

function flashKey(keyIndex, ok) {
  const p = state.practice;
  p.flash.set(keyIndex, { until: performance.now() + 180, ok });
}

function updateStats() {
  const p = state.practice;
  const s = p.stats;
  $("#statScore").textContent = String(s.score);
  $("#statCombo").textContent = String(s.combo);
  const judged = s.perfect + s.good + s.miss;
  $("#statAcc").textContent = judged ? `${Math.round(((s.perfect + s.good * 0.6) / judged) * 100)}%` : "--";
  $("#statProgress").textContent = `${p.judged} / ${p.notes.length}`;
}

function practiceTotalMs() {
  const p = state.practice;
  if (!p.notes.length) return 0;
  return Math.max(...p.notes.map((n) => n.t)) / p.speed;
}

function practiceFrame() {
  const p = state.practice;
  if (!p.running) { drawRoll(); return; }
  const now = performance.now();
  const elapsed = now - p.startAt;

  // 自动判定漏掉的音符（仅打分模式）
  if (p.mode === "score") {
    const t = elapsed * p.speed;
    for (const n of p.notes) {
      if (n.j === 0 && t > n.t + 260) {
        n.j = 2;
        p.stats.miss++;
        p.stats.combo = 0;
        p.judged++;
        $("#judgement").textContent = "漏按";
        $("#judgement").className = "judgement bad";
        updateStats();
      }
    }
  }

  drawRoll();

  // 高亮下一批音符
  const upcoming = p.notes.filter((n) => n.j === 0).slice(0, 4).map((n) => n.k);
  setGuide(upcoming);

  if (p.mode !== "wait") {
    if (elapsed > practiceTotalMs() + 1200) {
      finishPractice();
      return;
    }
  } else if (p.judged >= p.notes.length) {
    finishPractice();
    return;
  }
  requestAnimationFrame(practiceFrame);
}

function finishPractice() {
  const p = state.practice;
  stopPractice();
  const s = p.stats;
  const judged = s.perfect + s.good + s.miss;
  const acc = judged ? Math.round(((s.perfect + s.good * 0.6) / judged) * 100) : 0;
  $("#stageMsg").textContent = `完成！得分 ${s.score} · 准确率 ${acc}% · 最高连击 ${s.maxCombo}`;
  toast(`练习完成：${s.score} 分（准确率 ${acc}%）`);
  drawRoll();
}

/* ------------------------------------------------------------------ */
/* 练习画布（下落式钢琴卷帘）                                           */
/* ------------------------------------------------------------------ */

const canvas = $("#roll");
const ctx2d = canvas.getContext("2d");

function laneColor(keyIndex, alpha = 1) {
  const hue = 195 + keyIndex * 9;
  return `hsla(${hue}, 85%, ${62 - keyIndex * 2}%, ${alpha})`;
}

function drawRoll() {
  const p = state.practice;
  const W = canvas.width;
  const H = canvas.height;
  const g = ctx2d;
  g.clearRect(0, 0, W, H);

  // 背景
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a1020");
  bg.addColorStop(1, "#0d1428");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const laneW = W / 15;
  const hitY = H * 0.82;

  // 车道
  for (let i = 0; i < 15; i++) {
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.018)" : "rgba(255,255,255,0.04)";
    g.fillRect(i * laneW, 0, laneW, H);
    g.strokeStyle = "rgba(110,140,200,0.10)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(i * laneW, 0);
    g.lineTo(i * laneW, H);
    g.stroke();
  }

  // 判定线
  g.strokeStyle = "rgba(98,208,255,0.85)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, hitY);
  g.lineTo(W, hitY);
  g.stroke();

  if (!p.notes.length) {
    g.fillStyle = "rgba(180,196,230,0.6)";
    g.font = `${uiPx(15)} 'Segoe UI', 'Microsoft YaHei', sans-serif`;
    g.textAlign = "center";
    g.fillText("还没有选择乐谱", W / 2, H / 2 - 10);
    g.fillText("先到「导入乐谱」导入 .json / .txt / .skysheet", W / 2, H / 2 + 16);
    return;
  }

  const running = p.running;
  const t = running ? (performance.now() - p.startAt) * p.speed : 0;
  const leadMs = 4200; // 屏幕覆盖的时间范围
  const pxPerMs = (hitY - 24) / leadMs;

  // 目标键高亮
  const targets = new Set(p.notes.filter((n) => n.j === 0).slice(0, 4).map((n) => n.k));

  // 音符
  for (const n of p.notes) {
    const dt = n.t - t;
    if (dt > leadMs + 400) continue;
    if (dt < -600) continue;
    const y = hitY - dt * pxPerMs;
    if (y < -30 || y > H + 30) continue;
    const h = 14;
    const x = n.k * laneW + 4;
    const w = laneW - 8;
    g.globalAlpha = n.j === 0 ? 0.95 : n.j === 1 ? 0.35 : 0.12;
    g.fillStyle = n.j === 0 ? laneColor(n.k) : n.j === 1 ? "#66e39b" : "#ff6b81";
    roundRect(g, x, y - h / 2, w, h, 5);
    g.fill();
    if (n.j === 1 && n.hitAt !== undefined) {
      g.globalAlpha = 0.9;
      g.fillStyle = "#9dffc8";
      g.font = `${uiPx(11)} ui-monospace, Consolas, monospace`;
      g.textAlign = "center";
      g.fillText(n.diff !== undefined ? `+${Math.round(n.diff)}ms` : "", x + w / 2, y - 12);
    }
    g.globalAlpha = 1;
  }

  // 键盘接收区
  for (let i = 0; i < 15; i++) {
    const flash = p.flash.get(i);
    const isTarget = targets.has(i) && running;
    let fill = "rgba(34,48,79,0.9)";
    if (flash && flash.until > performance.now()) fill = flash.ok ? "rgba(102,227,155,0.85)" : "rgba(255,107,129,0.75)";
    else if (state.pressed.has(i)) fill = "rgba(92,199,245,0.85)";
    else if (isTarget) fill = "rgba(255,209,102,0.55)";
    g.fillStyle = fill;
    roundRect(g, i * laneW + 5, hitY + 6, laneW - 10, 46, 7);
    g.fill();
    g.fillStyle = isTarget || state.pressed.has(i) ? "#0b1220" : "#e6d3c8";
    g.font = `600 ${uiPx(13)} ui-monospace, Consolas, monospace`;
    g.textAlign = "center";
    g.fillText(KEY_LABELS[i], i * laneW + laneW / 2, hitY + 28);
    g.font = `${uiPx(10)} ui-monospace, Consolas, monospace`;
    g.globalAlpha = 0.75;
    g.fillText(NOTE_LETTERS[i], i * laneW + laneW / 2, hitY + 43);
    g.globalAlpha = 1;
  }

  // 进度条
  const total = Math.max(...p.notes.map((n) => n.t), 1);
  const progress = clamp(t / total, 0, 1);
  g.fillStyle = "rgba(98,208,255,0.25)";
  g.fillRect(0, H - 4, W, 4);
  g.fillStyle = "#62d0ff";
  g.fillRect(0, H - 4, W * progress, 4);
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

function initInstrumentSelect() {
  const select = $("#instrumentSelect");
  for (const inst of INSTRUMENTS) {
    const opt = el("option", undefined, inst.name);
    opt.value = inst.id;
    select.append(opt);
  }
  select.value = state.instrument;
  select.addEventListener("change", () => {
    state.instrument = select.value;
    audio.instrument = select.value;
    savePrefs();
    audio.prefetch(select.value);
    $("#statusText").textContent = `音色：${select.value}`;
  });
  audio.prefetch(state.instrument);
}

function initControls() {
  $("#volume").value = String(audio.volume);
  $("#volume").addEventListener("input", (e) => audio.setVolume(e.target.value));
  $("#audioEnable").addEventListener("click", async () => {
    await audio.resume();
    audio.prefetch(state.instrument);
    toast("声音已启用");
  });
  const scaleSelect = $("#uiScaleSelect");
  if (scaleSelect) {
    try { UI_SCALE_MODE = localStorage.getItem("skystudio-ui-scale") || "auto"; } catch {}
    scaleSelect.value = UI_SCALE_MODE;
    scaleSelect.addEventListener("change", () => {
      UI_SCALE_MODE = scaleSelect.value;
      try { localStorage.setItem("skystudio-ui-scale", UI_SCALE_MODE); } catch {}
      applyUiScale();
      requestAnimationFrame(() => { fitEditor(); fitPracticeCanvas(); fitFreeCanvas(); });
    });
  }
  const reloadBtn = $("#reloadBtn");
  if (reloadBtn) reloadBtn.addEventListener("click", () => location.reload());
  $("#pitchSelect").value = String(state.pitch);
  $("#pitchSelect").addEventListener("change", (e) => {
    state.pitch = Number(e.target.value) || 0;
    savePrefs();
  });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("#pickFiles").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length) importFiles([...e.target.files]);
    e.target.value = "";
  });

  const dz = $("#dropZone");
  for (const type of ["dragenter", "dragover"]) {
    dz.addEventListener(type, (e) => { e.preventDefault(); dz.classList.add("drag"); });
  }
  for (const type of ["dragleave", "drop"]) {
    dz.addEventListener(type, (e) => { e.preventDefault(); dz.classList.remove("drag"); });
  }
  dz.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]);
  });

  $("#practiceSheetSelect").addEventListener("change", (e) => { stopPractice(); selectPracticeSheet(e.target.value); });

  const practiceExport = $("#practiceExport");
  if (practiceExport) practiceExport.addEventListener("click", () => {
    const sheet = sheetById($("#practiceSheetSelect").value);
    if (!sheet) return;
    if (sheet.builtin) { toast("内置示例不能导出"); return; }
    exportSheet(sheet);
  });
  const practiceDelete = $("#practiceDelete");
  if (practiceDelete) practiceDelete.addEventListener("click", () => {
    const sheet = library.byId($("#practiceSheetSelect").value);
    if (!sheet) { toast("内置示例不能删除", true); return; }
    library.remove(sheet.id);
    refreshPracticeOptions();
    toast("已删除");
  });
  $("#modeSelect").addEventListener("change", () => { stopPractice(); selectPracticeSheet($("#practiceSheetSelect").value); });
  $("#speedSelect").addEventListener("change", () => { stopPractice(); selectPracticeSheet($("#practiceSheetSelect").value); });

  $("#startBtn").addEventListener("click", () => {
    if (state.practice.running) { stopPractice(); $("#stageMsg").textContent = "已停止"; }
    else startPractice();
  });
  $("#resetBtn").addEventListener("click", () => {
    stopPractice();
    selectPracticeSheet($("#practiceSheetSelect").value);
    toast("已重置");
  });

  document.addEventListener("pointerdown", () => { if (audio.ctx && audio.ctx.state !== "running") audio.resume().catch(() => {}); }, { once: true });
}

/* ------------------------------------------------------------------ */
/* 自由弹奏：音轨可视化                                                */
/* ------------------------------------------------------------------ */

state.freeNotes = [];

function recordFreeNote(keyIndex) {
  state.freeNotes.push({ t: performance.now(), k: keyIndex });
  if (state.freeNotes.length > 400) state.freeNotes.splice(0, state.freeNotes.length - 400);
  const msg = $("#freeMsg");
  if (msg) msg.style.display = "none";
}

function fitFreeCanvas() {
  const stage = $("#freeStage");
  const canvas = $("#freeRoll");
  if (!stage || !canvas) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  drawFreeRoll();
}

function drawFreeRoll() {
  const canvas = $("#freeRoll");
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const now = performance.now();
  const windowMs = 6000;
  const rowH = H / 15;

  const bg = g.createLinearGradient(0, 0, W, 0);
  bg.addColorStop(0, "#0a1120");
  bg.addColorStop(1, "#0d1528");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // 车道
  for (let r = 0; r < 15; r++) {
    g.fillStyle = r % 2 ? "rgba(255,255,255,.02)" : "rgba(255,255,255,.035)";
    g.fillRect(0, r * rowH, W, rowH);
    g.strokeStyle = "rgba(120,150,210,.10)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, Math.round(r * rowH) + 0.5);
    g.lineTo(W, Math.round(r * rowH) + 0.5);
    g.stroke();
  }

  // 右侧播放头
  g.strokeStyle = "rgba(98,208,255,.75)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W - 1, 0);
  g.lineTo(W - 1, H);
  g.stroke();

  // 音符块（自右向左滚动）
  const notes = state.freeNotes;
  for (const note of notes) {
    const age = now - note.t;
    const x = W - (age / windowMs) * W;
    if (x < -30 || x > W + 10) continue;
    const y = note.k * rowH + 2;
    const w = Math.max(10, Math.round(W * 0.012));
    const h = Math.max(6, rowH - 4);
    const alpha = Math.max(0.15, 1 - age / windowMs);
    g.globalAlpha = alpha;
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, `hsla(${198 + note.k * 9}, 85%, 66%, .95)`);
    grad.addColorStop(1, `hsla(${198 + note.k * 9}, 85%, 48%, .85)`);
    g.fillStyle = grad;
    roundRect(g, x - w, y, w, h, Math.min(5, w / 2));
    g.fill();
    if (rowH >= 18) {
      g.globalAlpha = Math.min(1, alpha + 0.1);
      g.fillStyle = "#0a1120";
      g.font = `${uiPx(9)} ui-monospace, Consolas, monospace`;
      g.textAlign = "center";
      g.fillText(NOTE_LETTERS[note.k], x - w / 2, y + h / 2 + 3);
    }
    g.globalAlpha = 1;
  }

  // 左上角提示
  g.fillStyle = "rgba(150,170,205,.55)";
  g.font = `${uiPx(11)} 'Segoe UI', 'Microsoft YaHei', sans-serif`;
  g.textAlign = "left";
  g.fillText("音轨（最近 6 秒）", 10, 16);
}

function freeTrackLoop() {
  if (state.tab === "free") drawFreeRoll();
  requestAnimationFrame(freeTrackLoop);
}

function initFreeTrack() {
  fitFreeCanvas();
  const stage = $("#freeStage");
  if (stage) {
    stage.addEventListener("click", () => {
      state.freeNotes = [];
      drawFreeRoll();
      const msg = $("#freeMsg");
      if (msg) msg.style.display = "";
      $("#nowPlaying").textContent = "已清空音轨 · 按下琴键开始";
    });
  }
  requestAnimationFrame(freeTrackLoop);
}
/* ------------------------------------------------------------------ */
/* 自动刷新：轮询服务端版本戳（修改 index.html/app.js/style.css 后生效）*/
/* ------------------------------------------------------------------ */

function reloadNotice() {
  let node = document.querySelector(".reload-banner");
  if (!node) {
    node = el("div", "reload-banner");
    node.append(el("span", undefined, "检测到新版本（当前有未保存内容）"));
    const btn = el("button", "btn accent", "立即刷新");
    btn.type = "button";
    btn.addEventListener("click", () => location.reload());
    node.append(btn);
    document.body.append(node);
  }
  node.classList.add("show");
}

function initAutoReload() {
  let initial = null;
  const busy = () =>
    (state.practice && state.practice.running) ||
    (state.editor && state.editor.notes.size > 0);
  async function tick() {
    try {
      const res = await fetch("/__version", { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      if (initial === null) { initial = version; return; }
      if (version !== initial) {
        if (busy()) reloadNotice();
        else location.reload();
      }
    } catch {}
  }
  tick();
  setInterval(tick, 1500);
}

/** 练习画布填满舞台（按容器尺寸重设画布分辨率并重绘） */
function fitPracticeCanvas() {
  const stage = document.querySelector("#practice .stage");
  const canvas = $("#roll");
  if (!stage || !canvas) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  drawRoll();
}function init() {
  loadPrefs();
  library.load();
  initInstrumentSelect();
  initControls();
  buildPianos();
  initEditor();
  initFreeTrack();
  applyUiScale();
  wbInit();
  requestAnimationFrame(() => { fitEditor(); renderEditor(); });
  initAutoReload();
  renderSheetList();
  refreshPracticeOptions();
  selectPracticeSheet($("#practiceSheetSelect").value);
  updateAudioButton();
  drawRoll();
  $("#statusText").textContent = "就绪 · 15 键 · 钢琴 / 水钢琴";
  // 支持 #free / #import / #practice 深链接
  const hash = (location.hash || "").replace("#", "");
  if (["free", "import", "practice"].includes(hash)) switchTab(hash);
  // 窗口尺寸变化时重绘
  window.addEventListener("resize", () => { fitEditor(); fitPracticeCanvas(); fitFreeCanvas(); applyUiScale(); });
  requestAnimationFrame(function loop() {
    if (!state.practice.running) drawRoll();
    setTimeout(loop, 250);
  });
}

init();
