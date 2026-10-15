"use strict";
/* Ascend Music — the interface (hot-updatable: build_ui.mjs signs it into ui.json).
   One script, three homes:
   - the web app on GitHub Pages and the Android app (Capacitor): data on the device, live content + interface updates
   - the claude.ai page: the same app, progress synced to the Claude account, plus the live lesson studio */
(() => {
const APP_SCHEMA = 1;                        // highest content schema this build understands
const KEY = "ascendmusic.v1";                // practice data (synced to the Claude account on the claude.ai page)
const DEV_KEY = "ascendmusic.device";        // this device only: theme, reminders, update addresses
const CONTENT_KEY = "ascendmusic.content";   // cached live content update
const CFG = window.APP_CONFIG || {};
const IN_CLAUDE = !!(window.claude && typeof window.claude.use === "function");
const STUDIO_URL = CFG.studioUrl || "https://claude.ai/artifact/E63Nz5wcT78tWL1BaS5vJV";
const LIB = {
  abcjs: "https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.4.4/abcjs-basic-min.js",
  pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
};

/* ===================== content: bundled, or a newer cached live update ===================== */
const BUNDLED = window.PROGRAM;
let P = BUNDLED;
if (!IN_CLAUDE) {
  try {
    const c = JSON.parse(localStorage.getItem(CONTENT_KEY) || "null");
    if (c && c.sessions && c.schema <= APP_SCHEMA && c.version > BUNDLED.version) P = c;
  } catch (e) {}
}
let DAYS = P.days, PHASES = P.phases;
const applyContent = () => { DAYS = P.days; PHASES = P.phases; };

/* ===================== native (Capacitor) plugins — optional everywhere ===================== */
function plug(name) {
  const C = window.Capacitor;
  try { return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins[name]) || null; } catch (e) { return null; }
}
const NATIVE = (() => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform()); } catch (e) { return false; } })();

/* ===================== dates ===================== */
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseISO = s => { const p = String(s || "").split("-"); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const daysBetween = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = d => d.getDate() + " " + MONTHS[d.getMonth()];

/* ===================== state ===================== */
const blank = () => ({ v: 1, startDate: iso(mondayOf(new Date())), setup: false, sessions: {}, keys: {}, caged: {}, boxes: {},
  strains: {}, rep: {}, races: {}, recordings: [], updatedAt: 0 });
let S = blank();
let D = { theme: "", reminders: null, contentUrl: "", uiUrl: "", lastCheck: "" };
function adopt(o) {
  if (!o || typeof o !== "object") return;
  const b = blank();
  for (const k of Object.keys(b)) if (o[k] !== undefined && o[k] !== null) S[k] = o[k];
  if (!Array.isArray(S.recordings)) S.recordings = [];
  if (!S.startDate) S.startDate = b.startDate;
}
try {
  let raw = localStorage.getItem(KEY);
  if (!raw && IN_CLAUDE) raw = localStorage.getItem("woodshed.v1");      // data from the first claude.ai version
  if (raw) adopt(JSON.parse(raw));
} catch (e) {}
try { Object.assign(D, JSON.parse(localStorage.getItem(DEV_KEY) || "{}")); } catch (e) {}
const saveDevice = () => { try { localStorage.setItem(DEV_KEY, JSON.stringify(D)); } catch (e) {} };

let mirrorTimer = null;
function mirror() {                           // second copy in native storage: survives the WebView's storage being cleared
  const Pref = plug("Preferences");
  if (!Pref) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => { try { Pref.set({ key: "state", value: JSON.stringify(S) }); } catch (e) {} }, 400);
}
function save() {
  S.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  mirror();
  queueDb();
}

/* claude.ai page: progress lives in the artifact's store too, so it follows you between devices */
const SYNC = { doc: null, timer: null, writing: false, again: false, state: IN_CLAUDE ? "saving" : "device" };
function queueDb() {
  if (!SYNC.doc) return;
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(flushDb, 700);
  setSync("saving");
}
function flushDb() {
  if (!SYNC.doc) return;
  if (SYNC.writing) { SYNC.again = true; return; }
  SYNC.writing = true;
  SYNC.doc.set(JSON.parse(JSON.stringify(S))).then(() => {
    SYNC.writing = false; setSync("synced");
    if (SYNC.again) { SYNC.again = false; flushDb(); }
  }).catch(e => {
    SYNC.writing = false; SYNC.again = false;
    setSync(e && e.code === "unavailable" ? "offline" : "device");
  });
}
function setSync(s) {
  SYNC.state = s;
  document.querySelectorAll("[data-sync]").forEach(el => { el.textContent = syncLabel(); });
}
function syncLabel() {
  if (!IN_CLAUDE) return NATIVE ? "saved on this phone, with a second copy in the app's protected storage" : "saved in this browser";
  return SYNC.state === "synced" ? "saved to your Claude account"
    : SYNC.state === "saving" ? "saving…"
    : SYNC.state === "offline" ? "saved here — syncs when you're back online"
    : "saved in this browser";
}

/* ===================== music theory ===================== */
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJ_STEPS = [0, 2, 4, 5, 7, 9, 11];
const QUAL = ["maj", "min", "min", "maj", "maj", "min", "dim"];
const NUMERAL = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const ALL_KEYS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
const SIGS = { C: "no sharps or flats", G: "1♯ (F♯)", D: "2♯ (F♯ C♯)", A: "3♯ (F♯ C♯ G♯)", E: "4♯ (F♯ C♯ G♯ D♯)",
  B: "5♯ (F♯ C♯ G♯ D♯ A♯)", "F#": "6♯ (F♯ C♯ G♯ D♯ A♯ E♯)", Db: "5♭ (B♭ E♭ A♭ D♭ G♭)", Ab: "4♭ (B♭ E♭ A♭ D♭)",
  Eb: "3♭ (B♭ E♭ A♭)", Bb: "2♭ (B♭ E♭)", F: "1♭ (B♭)" };
const pretty = k => String(k).replace(/#/g, "♯").replace(/(?<=[A-G])b/g, "♭");
function pitchOf(k) {
  let pc = NAT[k[0]];
  for (const ch of k.slice(1)) pc += ch === "#" ? 1 : ch === "b" ? -1 : 0;
  return (pc + 120) % 12;
}
function spell(letter, pc) {
  let d = (pc - NAT[letter] + 12) % 12;
  if (d > 6) d -= 12;
  return letter + (d > 0 ? "#".repeat(d) : "b".repeat(-d));
}
function diatonic(key) {
  const li = LETTERS.indexOf(key[0]), pc = pitchOf(key);
  return MAJ_STEPS.map((off, i) => {
    const root = spell(LETTERS[(li + i) % 7], (pc + off) % 12), q = QUAL[i];
    return { numeral: NUMERAL[i], root, quality: q, name: pretty(root) + (q === "min" ? "m" : q === "dim" ? "dim" : "") };
  });
}

/* ===================== the plan ===================== */
const weekIndex = (startISO, today) => Math.floor(daysBetween(parseISO(startISO), today) / 7) + 1;
const dateOf = (startISO, week, dow) => addDays(parseISO(startISO), (week - 1) * 7 + (dow + 6) % 7);
const phaseOf = w => (PHASES.find(p => w >= p.a && w <= p.b) || PHASES[w < 1 ? 0 : PHASES.length - 1]).n;
const clampW = w => Math.max(1, Math.min(P.weeks, w));
const bpmFor = w => P.tempo.base + P.tempo.step * (clampW(w) - 1);
const curWeek = () => clampW(weekIndex(S.startDate, new Date()));
const theoryFor = w => P.theory.find(t => t.w === w) || P.theory.find(t => t.w === 0);
const keysCovered = w => { let out = []; for (let i = 1; i <= Math.min(w, P.weeks); i++) out = out.concat(P.weekKeys[i] || []); return out; };
const fill = (s, ctx) => String(s || "").replace(/\{(\w+)\}/g, (m, k) => ctx[k] != null ? ctx[k] : m);
const repPick = (ph, inst, fun) => { const v = S.rep[ph + "-" + inst + (fun ? "-fun" : "")]; return v && v.trim() ? v.trim() : null; };

function sessionItems(w, day) {
  const ph = phaseOf(w), inst = day.inst, th = theoryFor(w);
  const caged = P.caged[w] || { shapes: [], detail: "" };
  const ctx = { bpm: bpmFor(w), keys: (P.weekKeys[w] || []).map(pretty).join(" · "), shapes: caged.shapes.map(s => s + " shape").join(" and "),
    cagedDetail: caged.detail, phase: ph, week: w };
  const out = [{ id: "theory", title: "Theory — " + th.t, detail: th.d, tags: ["10 min", "Part " + th.s] }];
  for (const t of ((P.sessions[inst] || {})[ph] || [])) {
    let title = t.title, detail = t.detail;
    if (t.from) { const e = (P.weekly[t.from] || {})[w]; if (!e) continue; title = e.t; detail = e.d; }
    const allShapes = t.id === "caged" && !caged.shapes.length;
    if (allShapes && t.titleAll) title = t.titleAll;
    let tags = [];
    for (const tg of t.tags || []) {
      if (tg === "{shapeTags}") tags = tags.concat(allShapes ? ["all five shapes"] : caged.shapes);
      else { const v = fill(tg, ctx); if (v.trim()) tags.push(v); }
    }
    out.push({ id: t.id, title: fill(title, ctx), detail: fill(detail, ctx), tags, metro: t.metro ? bpmFor(w) : 0 });
  }
  const pick = repPick(ph, inst);
  out.push({ id: "rep", title: pick ? "Repertoire — " + pick : "Repertoire — pick a piece for this phase",
    detail: pick ? P.repertoire.picked : P.repertoire.suggest[ph + "-" + inst], tags: pick ? [] : ["choose in Plan"],
    lesson: pick ? { song: pick, inst } : null });
  const f = P.fun[day.k];
  out.push({ id: "fun", title: f.t, detail: f.d, tags: [], race: day.k === "mon" });
  for (const n of P.notes || []) if (n.phase === ph && n.inst === inst) out.push({ note: true, title: n.title, detail: n.detail });
  if (P.checkpoint && w % P.checkpoint.every === 0) {
    out.push({ id: "record", title: fill(P.checkpoint.title, { phase: ph }), detail: P.checkpoint.detail, tags: ["end of phase"] });
  }
  return out;
}
const checkables = (w, day) => sessionItems(w, day).filter(i => !i.note);
const sessKey = (w, dk) => "w" + w + "-" + dk;
function sess(w, dk) {
  const k = sessKey(w, dk);
  if (!S.sessions[k]) S.sessions[k] = { done: {}, notes: "", at: 0 };
  if (!S.sessions[k].done) S.sessions[k].done = {};
  return S.sessions[k];
}
function sessDone(w, day) {
  const st = S.sessions[sessKey(w, day.k)];
  if (!st || !st.done) return 0;
  return checkables(w, day).filter(i => st.done[i.id]).length;
}
const sessComplete = (w, day) => sessDone(w, day) >= checkables(w, day).length;
function todayInfo() {
  const now = new Date();
  return { now, week: weekIndex(S.startDate, now), day: DAYS.find(d => d.dow === now.getDay()) || null };
}
function nextSessionFrom(info) {
  const w = Math.max(1, info.week), dow = info.now.getDay();
  if (dow !== 0) {                            // Sunday closes the week: every session day is already behind us
    const d = DAYS.find(x => x.dow > dow);
    if (d) return { week: clampW(w), day: d };
  }
  return { week: clampW(w + 1), day: DAYS[0] };
}
function streak() {
  const info = todayInfo(), list = [];
  for (let w = 1; w <= Math.min(P.weeks, Math.max(1, info.week)); w++) {
    for (const d of DAYS) if (daysBetween(dateOf(S.startDate, w, d.dow), info.now) >= 0) list.push({ w, d });
  }
  let n = 0;
  for (let j = list.length - 1; j >= 0; j--) {
    const x = list[j];
    if (sessComplete(x.w, x.d)) n++;
    else if (j === list.length - 1 && daysBetween(dateOf(S.startDate, x.w, x.d.dow), info.now) === 0) continue;   // today, still open
    else break;
  }
  return n;
}
function totalDone() {
  let n = 0;
  for (let w = 1; w <= P.weeks; w++) for (const d of DAYS) if (sessComplete(w, d)) n++;
  return n;
}

/* ===================== DOM helpers ===================== */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e[k] = v;
    else if (typeof v !== "string" && k in e) e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
  return e;
}
const $ = id => document.getElementById(id);
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
const clone = o => JSON.parse(JSON.stringify(o));     // store snapshots are frozen: copy before keeping or editing
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
const TICK = '<svg viewBox="0 0 24 24"><path d="M4 12.5 9.5 18 20 6.5"/></svg>';
function toast(msg, ms = 2800, action) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = h("div", { class: "toast", role: "status" }, h("span", {}, msg),
    action ? h("button", { onclick: () => { t.remove(); action.run(); } }, action.label) : null);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
function haptic() { const H = plug("Haptics"); if (H) { try { H.impact({ style: "LIGHT" }); } catch (e) {} } }
/* two taps instead of confirm(): the claude.ai frame cannot show dialogs */
function armed(btn, label, run) {
  btn.onclick = () => {
    if (btn.dataset.armed) { run(); return; }
    btn.dataset.armed = "1"; const was = btn.textContent; btn.textContent = label; btn.classList.add("warn");
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = was; btn.classList.remove("warn"); } }, 4000);
  };
  return btn;
}
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error("Couldn't load " + src)); };
      document.head.append(s);
    });
  }
  return scripts[src];
}
function openExternal(url) {                  // a new tab on the web; the system browser in the Android app
  const a = h("a", { href: url, target: "_blank", rel: "noopener" });
  document.body.append(a); a.click(); a.remove();
}

/* ===================== shell ===================== */
const ICONS = {
  today: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  plan: '<svg viewBox="0 0 24 24"><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></svg>',
  lessons: '<svg viewBox="0 0 24 24"><path d="M4 5.5C6.5 4 9.5 4 12 5.5 14.5 4 17.5 4 20 5.5V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z"/><path d="M12 5.5V19"/></svg>',
  theory: '<svg viewBox="0 0 24 24"><circle cx="8" cy="17" r="3"/><path d="M11 17V4l8 2v3l-8-2"/></svg>',
  progress: '<svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>'
};
const TABS = ["today", "plan", "lessons", "theory", "progress"];
let TAB = "today";
function buildShell() {
  const app = $("app");
  app.replaceChildren(
    h("header", { class: "top" }, h("div", { class: "hrow" },
      h("div", { class: "brand" }, "Ascend ", h("i", {}, "Music")),
      h("div", { class: "hmeta" },
        h("span", { class: "chip wk", id: "hdr-week" }, "Week 1"),
        h("button", { class: "metro-btn", id: "metro-open", "aria-expanded": "false", "aria-label": "Metronome",
          html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3 5 21h14z"/><path d="M12 14 19 7"/></svg><span id="metro-label">60</span>' })))),
    h("main", { class: "wrap", id: "main" }, TABS.map(t => h("section", { class: "panel", id: "panel-" + t, hidden: t !== TAB }))),
    h("nav", { class: "tabbar" }, h("div", { class: "tabs", role: "tablist" },
      TABS.map(t => h("button", { class: "tab", role: "tab", "data-tab": t, "aria-selected": String(t === TAB),
        onclick: () => showTab(t), html: ICONS[t] + t[0].toUpperCase() + t.slice(1) })))),
    metroSheet());
  $("metro-open").onclick = () => $("metro-sheet").hidden ? openMetro() : closeMetro();
}
function showTab(name) {
  TAB = name;
  for (const t of TABS) $("panel-" + t).hidden = t !== name;
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  if (name === "lessons") renderLessons();
  window.scrollTo({ top: 0 });
}

/* ===================== TODAY ===================== */
const VIEW = { week: 1, day: null };
function renderToday() {
  const p = $("panel-today");
  p.replaceChildren();
  const info = todayInfo();
  if (!S.setup) p.append(setupCard());
  if (info.week > P.weeks) { p.append(finishedCard(), weekStrip(P.weeks)); return; }
  let w, day, isToday = false;
  if (VIEW.day) { w = VIEW.week; day = VIEW.day; }
  else if (info.week < 1) {
    p.append(h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Not started yet"),
      h("p", { class: "lede" }, "Week 1 begins " + shortDate(parseISO(S.startDate)) + ". The session below is what that Monday looks like.")));
    w = 1; day = DAYS[0];
  } else if (info.day) { w = info.week; day = info.day; isToday = true; }
  else { const nx = nextSessionFrom(info); w = nx.week; day = nx.day; }
  p.append(sessionCard(w, day, isToday), weekStrip(clampW(info.week)));
}
function setupCard() {
  const inp = h("input", { type: "date", id: "setup-date", value: S.startDate, "aria-label": "Week 1 start date" });
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, "First, set your start"),
    h("p", { class: "lede" }, "Week 1 is set to the Monday of this week. If you began earlier, change it — this screen then always shows the right session."),
    h("div", { class: "row" }, inp,
      h("button", { class: "btn pri", onclick: () => {
        if (inp.value) S.startDate = iso(mondayOf(parseISO(inp.value)));
        S.setup = true; save(); renderAll(); toast("Week 1 starts " + shortDate(parseISO(S.startDate)));
      } }, "Set week 1"),
      h("button", { class: "btn", onclick: () => { S.setup = true; save(); renderAll(); } }, "Keep this week")));
}
function finishedCard() {
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, P.weeks + " weeks done"),
    h("div", { class: "sday", html: "All three phases <em>complete</em>" }),
    h("p", { class: "lede" }, "Record the checkpoint exercise one last time and compare it with week 1. Then run the improvisation phase again in new keys, or start a fresh block."),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: () => {
      S.startDate = iso(mondayOf(new Date())); S.sessions = {}; save(); renderAll(); toast("New block started");
    } }, "Start a new " + P.weeks + " weeks")));
}
function sessionCard(w, day, isToday) {
  const ph = phaseOf(w), items = sessionItems(w, day), total = items.filter(i => !i.note).length, st = sess(w, day.k);
  const fill_ = h("i", { style: "width:" + (total ? Math.round(sessDone(w, day) / total * 100) : 0) + "%" });
  const count = h("div", { class: "sub" }, sessDone(w, day) + " of " + total + " done");
  const refresh = () => {
    const n = sessDone(w, day);
    fill_.style.width = (total ? Math.round(n / total * 100) : 0) + "%";
    count.textContent = n + " of " + total + " done";
    return n;
  };
  const list = h("div", { class: "items" });
  for (const it of items) {
    if (it.note) {
      list.append(h("div", { class: "aside" }, h("div", { class: "mark" }, "✻"),
        h("div", {}, h("div", {}, it.title), it.detail ? h("div", { style: "margin-top:3px;color:var(--ink-faint)" }, it.detail) : null)));
      continue;
    }
    const tags = h("div", { class: "tags" }, (it.tags || []).map(t => h("span", { class: "tag" + (/^♩/.test(t) ? " mono" : "") }, t)));
    if (it.metro) tags.append(h("button", { class: "tag act", onclick: e => { e.stopPropagation(); openMetro(it.metro); } }, "Metronome ♩ = " + it.metro));
    if (it.race) tags.append(h("button", { class: "tag act", onclick: e => { e.stopPropagation(); showTab("progress");
      setTimeout(() => { const r = $("race-card"); if (r) r.scrollIntoView({ block: "center", behavior: "smooth" }); }, 60); } }, "Open scale race"));
    if (it.lesson) tags.append(h("button", { class: "tag act blue", onclick: e => { e.stopPropagation(); askLesson(it.lesson); } }, "Get a lesson"));
    const row = h("button", { class: "item" + (st.done[it.id] ? " done" : ""), type: "button" },
      h("div", { class: "box", html: TICK }),
      h("div", {}, h("div", { class: "it" }, it.title), it.detail ? h("div", { class: "id" }, it.detail) : null, tags.childNodes.length ? tags : null));
    row.onclick = () => {
      const on = !st.done[it.id];
      if (on) st.done[it.id] = true; else delete st.done[it.id];
      row.classList.toggle("done", on);
      if (on) haptic();
      if (on && it.id === "scales") for (const k of P.weekKeys[w] || []) { S.keys[k] = S.keys[k] || {}; S.keys[k].major = true; }
      if (on && it.id === "caged") for (const s of (P.caged[w] || {}).shapes || []) S.caged[s] = true;
      if (refresh() >= total && on) { st.at = Date.now(); toast("Session complete — " + streakWord()); }
      save();
    };
    list.append(row);
  }
  const notes = h("textarea", { id: "today-notes", rows: 2, placeholder: "Notes from this session — what stuck, what to fix next time" });
  notes.value = st.notes || "";
  notes.oninput = () => { st.notes = notes.value; save(); };
  const actions = h("div", { class: "row" }, h("button", { class: "btn good", onclick: () => {
    for (const i of checkables(w, day)) st.done[i.id] = true;
    st.at = Date.now();
    if (ph === 1) {
      for (const k of P.weekKeys[w] || []) { S.keys[k] = S.keys[k] || {}; S.keys[k].major = true; }
      for (const s of (P.caged[w] || {}).shapes || []) S.caged[s] = true;
    }
    save(); renderAll(); toast("Session complete — " + streakWord());
  } }, "Mark the session done"));
  if (VIEW.day) actions.append(h("button", { class: "btn", onclick: () => { VIEW.day = null; renderAll(); } }, "Back to today"));
  else if (!isToday) actions.append(h("button", { class: "btn", onclick: () => { VIEW.week = w; VIEW.day = day; renderAll(); } }, "Practising early? Open this now"));
  return h("div", { class: "card" },
    h("div", { class: "shead" },
      h("div", { class: "sday", html: (isToday ? "Today — " : "") + esc(day.label) + " <em>" + day.inst + "</em>" }),
      h("div", { class: "sub" }, "Week " + w + " of " + P.weeks + " · Phase " + ph + ", " + PHASES[ph - 1].name + " · " + shortDate(dateOf(S.startDate, w, day.dow)))),
    h("div", { class: "pbar" }, fill_), count, list, notes, actions,
    h("div", { class: "sync", "data-sync": "" }, syncLabel()));
}
const streakWord = () => { const n = streak(); return n <= 1 ? "that's one" : n + " in a row"; };
function weekStrip(w) {
  const info = todayInfo();
  return h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Week " + w),
    h("div", { class: "items" }, DAYS.map(d => {
      const date = dateOf(S.startDate, w, d.dow), done = sessComplete(w, d), gap = daysBetween(date, info.now);
      const n = sessDone(w, d), tot = checkables(w, d).length;
      const status = done ? "complete" : gap > 0 ? (n ? n + " of " + tot + " done" : "missed") : n ? n + " of " + tot + " done" : "not started";
      return h("button", { class: "item" + (done ? " done" : ""), type: "button", onclick: () => {
        VIEW.week = w; VIEW.day = d; renderAll(); window.scrollTo({ top: 0, behavior: "smooth" }); } },
        h("div", { class: "box", html: TICK }),
        h("div", {}, h("div", { class: "it", html: esc(d.short) + " · <span class=\"inst-" + d.inst + "\">" + d.inst + "</span>" + (gap === 0 ? " — today" : "") }),
          h("div", { class: "id", style: !done && gap > 0 ? "color:var(--flag)" : null }, shortDate(date) + " · " + status)));
    })));
}

/* ===================== PLAN ===================== */
function renderPlan() {
  const p = $("panel-plan");
  const cur = clampW(todayInfo().week);
  const start = h("input", { type: "date", id: "plan-start", value: S.startDate });
  start.onchange = () => { if (start.value) { S.startDate = iso(mondayOf(parseISO(start.value))); S.setup = true; save(); renderAll();
    toast("Week 1 starts " + shortDate(parseISO(S.startDate))); } };
  const pairs = {};
  for (const d of DAYS) (pairs[d.inst] = pairs[d.inst] || []).push(d.short);
  put(p,
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, P.weeks + " weeks, " + DAYS.length + " sessions a week"),
      h("div", { class: "sday", html: Object.entries(pairs).map(([i, ds]) => ds.join(" &amp; ") + " <em>" + i + "</em>").join(" · ") }),
      h("p", { class: "lede" }, "Keep the day-to-instrument pairing fixed — it removes the decision about what to practise. Theory runs for the first ten minutes of every session until it is automatic, then it becomes background knowledge you apply."),
      h("div", { class: "row" }, h("label", { for: "plan-start", class: "sub" }, "Week 1 starts"), start)),
    PHASES.map(ph => h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "Phase " + ph.n + " · weeks " + ph.a + "–" + ph.b),
      h("div", { class: "sday md" }, ph.name),
      ["piano", "guitar"].map(inst => h("p", { class: "lede" }, h("strong", { class: "inst-" + inst }, inst + " — "), ph[inst])),
      ["piano", "guitar"].map(inst => h("div", { style: "display:grid;gap:7px" }, [["", "Repertoire pick"], ["-fun", "Just for fun"]].map(([suf, label]) => {
        const key = ph.n + "-" + inst + suf;
        const i = h("input", { id: "rep-" + key, list: "lib-" + inst,
          placeholder: suf ? "Anything you love — no pressure, no metronome" : P.repertoire.suggest[ph.n + "-" + inst] || "" });
        i.value = S.rep[key] || "";
        i.oninput = () => { S.rep[key] = i.value; save(); };
        i.onblur = () => renderToday();
        return h("div", { class: "field" }, h("label", { class: "eyebrow", for: "rep-" + key }, label + " · " + inst), i);
      }))),
      Array.from({ length: ph.b - ph.a + 1 }, (_, k) => weekDetail(ph.a + k, ph.a + k === cur)))),
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "The shape of a week"),
      h("div", { class: "tscroll", html: "<table><thead><tr><th>Day</th><th>Instrument</th><th>Focus</th><th>Fun element</th></tr></thead><tbody>" +
        DAYS.map(d => "<tr><td class=\"n\">" + d.short + "</td><td class=\"n inst-" + d.inst + "\">" + d.inst + "</td><td>" +
          (d.inst === "piano" ? "Theory, Hanon, scales, repertoire" : "Theory, shapes, rhythm, repertoire") + "</td><td>" + esc(P.fun[d.k].t) + "</td></tr>").join("") +
        "</tbody></table>" }),
      h("p", { class: "lede" }, "Every session includes something that is just enjoyable. Not everything has to earn its place through technical merit.")),
    h("datalist", { id: "lib-piano" }, P.library.piano.map(s => h("option", { value: s }))),
    h("datalist", { id: "lib-guitar" }, P.library.guitar.map(s => h("option", { value: s }))));
}
function weekDetail(w, isCur) {
  const th = theoryFor(w);
  const body = h("div", { class: "dbody" }, h("p", { html: "<strong>Theory (" + esc(th.s) + ")</strong> — " + esc(th.d) }));
  for (const inst of ["piano", "guitar"]) {
    const day = DAYS.find(d => d.inst === inst);
    if (!day) continue;
    const items = sessionItems(w, day).filter(i => !i.note && !["theory", "fun", "rep"].includes(i.id));
    body.append(h("p", { html: "<strong class=\"inst-" + inst + "\">" + inst + "</strong> — " + items.map(i => esc(i.title)).join(" · ") }));
  }
  if (phaseOf(w) === 1) {
    body.append(h("p", { html: "<strong>Keys</strong> — " + (P.weekKeys[w] || []).map(pretty).join(", ") +
      " &nbsp;·&nbsp; <strong>CAGED</strong> — " + (((P.caged[w] || {}).shapes || []).join(", ") || "all five, consolidated") +
      " &nbsp;·&nbsp; <strong>Hanon</strong> — ♩ = " + bpmFor(w) }));
  }
  return h("details", { open: isCur }, h("summary", { html: "<span class=\"num\" style=\"color:var(--ink-faint)\">W" + w + "</span>&nbsp; " + esc(th.t) +
    (isCur ? " <span class=\"tag\" style=\"color:var(--ink)\">this week</span>" : "") }), body);
}

/* ===================== THEORY ===================== */
let cofSel = "C";
function renderTheory() {
  put($("panel-theory"),
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "Part 1 · the backbone"),
      h("div", { class: "sday md", html: "Theory <em>foundation</em>" }),
      h("p", { class: "lede" }, "Ten minutes at the start of every session until it is automatic, roughly weeks 1–4. After that you apply it rather than study it. Everything you play in phases 2 and 3 ties back here.")),
    h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Circle of fifths · tap a key"), h("div", { class: "cof" }, cofSvg(), cofDetail())),
    h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Reference"),
      P.reference.map(r => h("details", {}, h("summary", {}, r.title),
        h("div", { class: "dbody" }, h("div", { html: r.html }), r.table === "diatonic" ? diatonicTable() : null)))),
    h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Keeping it fun · read when motivation dips"),
      P.principles.map(([t, d]) => h("div", { style: "display:grid;gap:3px" }, h("div", { style: "font-weight:600" }, t), h("div", { class: "lede" }, d)))));
}
function cofSvg() {
  const R = 100, r = 66, cx = 118, cy = 118;
  let svg = '<svg viewBox="0 0 236 236" role="img" aria-label="Circle of fifths"><circle class="ring" cx="' + cx + '" cy="' + cy + '" r="' + (R + 16) + '"/>';
  ALL_KEYS.forEach((k, i) => {
    const a = i / 12 * Math.PI * 2 - Math.PI / 2, x = (cx + Math.cos(a) * R).toFixed(1), y = (cy + Math.sin(a) * R).toFixed(1);
    const sel = k === cofSel;
    svg += '<g class="node" data-key="' + k + '" tabindex="0" role="button" aria-label="' + pretty(k) + ' major"><circle class="maj' + (sel ? " sel" : "") +
      '" cx="' + x + '" cy="' + y + '" r="17"/><text class="' + (sel ? "sel-t" : "") + '" x="' + x + '" y="' + y + '">' + pretty(k) + "</text></g>";
    svg += '<text class="min-t" x="' + (cx + Math.cos(a) * r).toFixed(1) + '" y="' + (cy + Math.sin(a) * r).toFixed(1) + '">' + diatonic(k)[5].name + "</text>";
  });
  svg += '<text x="' + cx + '" y="' + (cy - 8) + '" class="min-t">relative</text><text x="' + cx + '" y="' + (cy + 6) + '" class="min-t">minors</text><text x="' + cx + '" y="' + (cy + 20) + '" class="min-t">inside</text></svg>';
  const wrap = h("div", { html: svg });
  wrap.querySelectorAll(".node").forEach(n => {
    const pick = () => { cofSel = n.dataset.key; renderTheory(); };
    n.addEventListener("click", pick);
    n.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  });
  return wrap;
}
function cofDetail() {
  const ch = diatonic(cofSel), covered = S.keys[cofSel] || {};
  return h("div", { style: "display:grid;gap:9px;min-width:0" },
    h("div", { style: "font-family:var(--display);font-size:26px;font-weight:700" }, pretty(cofSel) + " major"),
    h("div", { class: "lede" }, SIGS[cofSel]),
    h("div", { class: "tscroll", html: '<table class="fit"><thead><tr>' + ch.map(c => '<th style="text-align:center">' + c.numeral + "</th>").join("") +
      "</tr></thead><tbody><tr>" + ch.map(c => '<td class="n" style="text-align:center">' + c.name + "</td>").join("") + "</tr></tbody></table>" }),
    h("div", { class: "lede", html: "Relative minor <strong>" + ch[5].name + "</strong> · ii–V–I is <strong>" + ch[1].name + " – " + ch[4].name + "7 – " + ch[0].name + "maj7</strong>" }),
    h("div", { class: "row" }, [["major", "Major scale built"], ["minor", "Relative minor built"]].map(([f, label]) =>
      h("button", { class: "pill" + (covered[f] ? " on" : ""), onclick: () => {
        S.keys[cofSel] = S.keys[cofSel] || {}; S.keys[cofSel][f] = !S.keys[cofSel][f]; save(); renderTheory(); renderProgress();
      } }, label))));
}
const diatonicTable = () => h("div", { class: "tscroll", html: "<table><thead><tr><th>Degree</th>" + NUMERAL.map(n => "<th>" + n + "</th>").join("") +
  "</tr></thead><tbody><tr><td>Quality</td><td>Major</td><td>minor</td><td>minor</td><td>Major</td><td>Major</td><td>minor</td><td>dim</td></tr>" +
  "<tr><td>Function</td><td>Tonic</td><td>Subdominant</td><td>Tonic</td><td>Subdominant</td><td>Dominant</td><td>Tonic</td><td>Dominant</td></tr></tbody></table>" });

/* ===================== PROGRESS + settings ===================== */
function renderProgress() {
  const info = todayInfo(), cur = clampW(info.week), total = P.weeks * DAYS.length;
  const grid = h("div", { class: "grid12" }, h("div", { class: "gh" }), DAYS.map(d => h("div", { class: "gh" }, d.short)));
  for (let w = 1; w <= P.weeks; w++) {
    grid.append(h("div", { class: "gw" }, "W" + w));
    for (const d of DAYS) {
      const date = dateOf(S.startDate, w, d.dow), done = sessComplete(w, d), gap = daysBetween(date, info.now), n = sessDone(w, d);
      grid.append(h("div", { class: "cell " + (d.inst === "piano" ? "p" : "g") + (done ? " done" : gap > 0 ? " miss" : "") + (gap === 0 ? " now" : ""),
        title: d.short + " week " + w + " — " + shortDate(date) }, done ? "✓" : n ? n + "/" + checkables(w, d).length : ""));
    }
  }
  const pills = (items, cls, onTap) => h("div", { class: "pills" }, items.map(([label, state, key]) =>
    h("button", { class: "pill" + (state === 2 ? " on" : state === 1 ? " half" : ""), onclick: () => { onTap(key); save(); renderProgress(); } }, label)));
  put($("panel-progress"),
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "Where you are"),
      h("div", { class: "stats" }, [[streak(), "streak"], [totalDone(), "of " + total + " sessions"], [bpmFor(cur), "♩ target"]].map(([v, l]) =>
        h("div", { class: "stat" }, h("b", {}, v), h("span", {}, l)))),
      grid,
      h("p", { class: "lede", html: '<span class="inst-piano">Blue outline</span> piano · <span class="inst-guitar">brass outline</span> guitar · dashed means a session went by unfinished.' })),
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "Coverage"),
      subhead("12 major scales", "Tap once for the major scale, twice to add its relative minor."),
      pills(ALL_KEYS.map(k => { const s = S.keys[k] || {}; return [pretty(k), s.major && s.minor ? 2 : s.major ? 1 : 0, k]; }), "", k => {
        const s = S.keys[k] = S.keys[k] || {};
        if (!s.major) s.major = true; else if (!s.minor) s.minor = true; else { s.major = false; s.minor = false; }
      }),
      subhead("CAGED shapes", "Each shape mapped as a moveable shape, not just an open chord."),
      pills(["C", "A", "G", "E", "D"].map(s => [s + " shape", S.caged[s] ? 2 : 0, s]), "", s => { S.caged[s] = !S.caged[s]; }),
      subhead("Minor pentatonic boxes", "Five CAGED-adjacent positions. Box 1 is the A minor pentatonic reference."),
      pills([1, 2, 3, 4, 5].map(n => ["Box " + n, S.boxes[n] ? 2 : 0, n]), "", n => { S.boxes[n] = !S.boxes[n]; }),
      subhead("Maple Leaf Rag · AABBACCD", "Tap for learned, again for up to tempo."),
      pills(["A", "B", "C", "D"].map(s => { const v = S.strains[s] || 0; return ["Strain " + s + (v === 2 ? " · tempo" : v === 1 ? " · learned" : ""), v, s]; }), "",
        s => { S.strains[s] = ((S.strains[s] || 0) + 1) % 3; })),
    raceCard(),
    recordingsCard(cur),
    NATIVE ? remindersCard() : null,
    dataCard(),
    !IN_CLAUDE ? appCard() : null);
}
function subhead(t, s) {
  return h("div", { style: "display:grid;gap:2px;margin-top:4px" }, h("div", { style: "font-weight:600" }, t), s ? h("div", { class: "lede" }, s) : null);
}
function recordingsCard(cur) {
  const sel = h("select", { id: "rec-inst", "aria-label": "Instrument" }, h("option", { value: "piano" }, "piano"), h("option", { value: "guitar" }, "guitar"));
  const note = h("input", { id: "rec-note", placeholder: "What you played, and how it went", style: "flex:1 1 180px" });
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, "Checkpoint recordings"),
    h("p", { class: "lede" }, "End of each phase — weeks 4, 8 and 12 — record the same simple exercise on both instruments. A direct before/after beats asking yourself whether you feel better."),
    h("div", { class: "row" }, sel, note, h("button", { class: "btn pri", onclick: () => {
      S.recordings.unshift({ id: "r" + Date.now(), date: iso(new Date()), week: cur, phase: phaseOf(cur), inst: sel.value, note: note.value.trim() });
      save(); renderProgress(); toast("Logged");
    } }, "Log it")),
    S.recordings.length ? h("div", { class: "items" }, S.recordings.slice(0, 12).map(r => h("div", { class: "item", style: "grid-template-columns:1fr auto" },
      h("div", {}, h("div", { class: "it", html: '<span class="inst-' + esc(r.inst) + '">' + esc(r.inst) + "</span> · week " + esc(r.week || "?") +
        ' <span class="num" style="color:var(--ink-faint)">' + esc(r.date) + "</span>" }), r.note ? h("div", { class: "id" }, r.note) : null),
      h("button", { class: "btn sm", onclick: () => { S.recordings = S.recordings.filter(q => q.id !== r.id); save(); renderProgress(); } }, "Remove")))) : null);
}
let raceT = null, raceStart = 0;
function raceCard() {
  const sel = h("select", { id: "race-key", "aria-label": "Scale" }, ALL_KEYS.map(k => h("option", { value: k }, pretty(k) + " major")));
  const time = h("div", { class: "timer", id: "race-time" }, "0.0");
  const go = h("button", { class: "btn pri", id: "race-go" }, "Start");
  go.onclick = () => {
    if (raceT) {
      clearInterval(raceT); raceT = null;
      const secs = (Date.now() - raceStart) / 1000, k = sel.value, prev = S.races[k] && S.races[k].best, beat = !prev || secs < prev;
      if (beat) S.races[k] = { best: Math.round(secs * 10) / 10, at: Date.now() };
      save();
      toast(beat ? (prev ? "New best — " + secs.toFixed(1) + "s, down from " + prev.toFixed(1) + "s" : "First time for " + pretty(k) + " — " + secs.toFixed(1) + "s")
        : secs.toFixed(1) + "s · your best is " + prev.toFixed(1) + "s");
      renderProgress();
    } else {
      raceStart = Date.now(); go.textContent = "Stop";
      raceT = setInterval(() => { const t = $("race-time"); if (t) t.textContent = ((Date.now() - raceStart) / 1000).toFixed(1); }, 100);
    }
  };
  const bests = ALL_KEYS.filter(k => S.races[k]);
  return h("div", { class: "card", id: "race-card" },
    h("div", { class: "eyebrow" }, "Scale race · Monday's game"),
    h("p", { class: "lede" }, "One clean run at this week's tempo. Accuracy first — a fast scale with a fluffed thumb tuck does not count."),
    h("div", { class: "row" }, sel, time, go),
    bests.length ? h("div", { class: "kv" }, bests.map(k => [h("div", { class: "k" }, pretty(k) + " major"), h("div", { class: "v" }, S.races[k].best.toFixed(1) + "s")])) : null);
}

/* reminders (Android app) */
const REM_BASE = 300;
async function applyReminders() {
  const LN = plug("LocalNotifications");
  if (!LN) return { ok: false, why: "Reminders work in the Android app." };
  const r = D.reminders || { on: false };
  try {
    await LN.cancel({ notifications: [0, 1, 2, 3, 4, 5, 6].map(i => ({ id: REM_BASE + i })) });
    if (!r.on) return { ok: true, off: true };
    const perm = await LN.requestPermissions();
    if (perm.display !== "granted") return { ok: false, why: "Notifications are blocked — allow them for Ascend Music in Android settings." };
    const [hh, mm] = (r.time || "18:00").split(":").map(Number);
    const notifications = DAYS.filter(d => !r.skip || !r.skip.includes(d.k)).map(d => ({
      id: REM_BASE + d.dow, title: d.inst === "piano" ? "Piano tonight" : "Guitar tonight",
      body: "Open Ascend Music for today's " + d.inst + " session.",
      schedule: { on: { weekday: d.dow + 1, hour: hh, minute: mm }, allowWhileIdle: true }      // weekday 1 = Sunday
    }));
    if (notifications.length) await LN.schedule({ notifications });
    return { ok: true, count: notifications.length };
  } catch (e) {
    return { ok: false, why: "Couldn't schedule reminders: " + (e && e.message || e) };
  }
}
function remindersCard() {
  const r = D.reminders = D.reminders || { on: false, time: "18:00", skip: [] };
  if (!Array.isArray(r.skip)) r.skip = [];
  const status = h("p", { class: "lede" }, r.on ? "On for " + DAYS.filter(d => !r.skip.includes(d.k)).map(d => d.short).join(", ") + " at " + r.time + "." : "Off.");
  const apply = async () => {
    saveDevice();
    const res = await applyReminders();
    status.textContent = res.ok ? (res.off ? "Off." : "Scheduled " + res.count + " weekly reminder" + (res.count === 1 ? "" : "s") + ".") : res.why;
  };
  const on = h("input", { type: "checkbox", id: "rem-on", checked: !!r.on });
  on.onchange = () => { r.on = on.checked; apply(); };
  const time = h("input", { type: "time", id: "rem-time", value: r.time });
  time.onchange = () => { r.time = time.value || "18:00"; if (r.on) apply(); else saveDevice(); };
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, "Reminders"),
    h("label", { class: "switch", for: "rem-on" }, on, h("span", {}, "Remind me on session days")),
    h("div", { class: "row" }, h("label", { class: "sub", for: "rem-time" }, "at"), time),
    h("div", { class: "pills" }, DAYS.map(d => h("button", { class: "pill" + (r.skip.includes(d.k) ? "" : " on"), onclick: e => {
      const i = r.skip.indexOf(d.k); if (i >= 0) r.skip.splice(i, 1); else r.skip.push(d.k);
      e.currentTarget.classList.toggle("on", !r.skip.includes(d.k));
      if (r.on) apply(); else saveDevice();
    } }, d.short + " · " + d.inst))),
    status);
}

/* backup + restore */
const backupJson = () => JSON.stringify({ app: "ascend-music", exported: new Date().toISOString(), state: S });
async function exportBackup() {
  const name = "ascend-music-backup-" + iso(new Date()) + ".json";
  const FS = plug("Filesystem"), Share = plug("Share");
  try {
    if (FS && Share) {
      const r = await FS.writeFile({ path: name, data: backupJson(), directory: "CACHE", encoding: "utf8" });
      await Share.share({ title: "Ascend Music backup", text: "Ascend Music backup file", url: r.uri, dialogTitle: "Save or send your backup" });
      return;
    }
    if (IN_CLAUDE) { backupModal("show"); return; }      // the claude.ai frame can't start downloads
    const a = h("a", { href: URL.createObjectURL(new Blob([backupJson()], { type: "application/json" })), download: name });
    document.body.append(a); a.click(); a.remove();
    toast("Backup downloaded");
  } catch (e) { backupModal("show"); }
}
function restoreFrom(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { toast("That isn't valid backup text."); return false; }
  const st = o && o.state ? o.state : o;
  if (!st || typeof st !== "object" || !("sessions" in st)) { toast("That doesn't look like an Ascend Music backup."); return false; }
  S = blank(); adopt(st); S.setup = true; save(); closeModal(); renderAll(); toast("Backup restored");
  return true;
}
function backupModal(mode) {
  const ta = h("textarea", { class: "mono-ta", rows: 9, spellcheck: "false", id: "backup-text", placeholder: mode === "paste" ? "Paste your backup text here" : "" });
  if (mode === "show") ta.value = backupJson();
  const go = h("button", { class: "btn pri" }, mode === "show" ? "Copy" : "Replace this device's data");
  if (mode === "show") go.onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast("Copied"); } catch (e) { ta.focus(); ta.select(); toast("Select all and copy"); }
  };
  else armed(go, "Tap again to replace", () => restoreFrom(ta.value));
  openModal(h("div", { class: "eyebrow" }, mode === "show" ? "Backup text" : "Restore from text"),
    h("p", { class: "lede" }, mode === "show" ? "Keep this somewhere safe — notes, or an email to yourself. Paste it into Restore on any device, including the claude.ai version."
      : "Paste backup text from this app or from the claude.ai version. Everything on this device is replaced."),
    ta, h("div", { class: "row" }, go, h("button", { class: "btn", onclick: closeModal }, "Close")));
}
function openModal(...kids) {
  closeModal();
  const m = h("div", { class: "modal", id: "modal", onclick: e => { if (e.target === m) closeModal(); } }, h("div", { class: "modal-in", role: "dialog", "aria-modal": "true" }, kids));
  document.body.append(m);
}
function closeModal() { const m = $("modal"); if (m) m.remove(); }
function dataCard() {
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, "Your data"),
    h("div", { class: "sync", "data-sync": "" }, syncLabel()),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: exportBackup }, NATIVE ? "Export a backup" : IN_CLAUDE ? "Copy a backup" : "Download a backup"),
      !IN_CLAUDE ? h("button", { class: "btn", onclick: () => backupModal("show") }, "Show backup text") : null,
      h("button", { class: "btn", onclick: () => backupModal("paste") }, "Restore"),
      armed(h("button", { class: "btn" }, "Reset the " + P.weeks + " weeks"), "Tap again to erase progress", () => {
        S = blank(); save(); renderAll(); toast("Reset");
      })));
}
function appCard() {
  const status = h("p", { class: "lede" }, "Plan v" + P.version + " · interface v" + (window.UI_RUNNING_VERSION || "?") +
    (window.UI_SOURCE === "live" ? " (live update)" : "") + (D.lastCheck ? " · checked " + new Date(D.lastCheck).toLocaleString() : ""));
  const themes = [["", "System"], ["light", "Light"], ["dark", "Dark"]];
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, "App"),
    h("div", { class: "row" }, h("span", { class: "sub" }, "Theme"), h("div", { class: "seg" }, themes.map(([v, l]) =>
      h("button", { "aria-pressed": String((D.theme || "") === v), class: (D.theme || "") === v ? "piano" : "", onclick: () => {
        D.theme = v; saveDevice(); applyTheme(); renderProgress(); } }, l)))),
    status,
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: async () => {
        status.textContent = "Checking…";
        const [c, u] = await Promise.all([checkUpdates(), checkUiUpdate()]);
        status.textContent = (c.status === "updated" ? "Plan updated to v" + c.version + ". " : c.status === "current" ? "Plan is current. " : "Plan: " + (c.error || c.status) + ". ") +
          (u.status === "updated" ? "New interface ready — restart to use it." : u.status === "current" ? "Interface is current." : "Interface: " + (u.error || u.status) + ".");
      } }, "Check for updates"),
      h("a", { class: "btn", href: STUDIO_URL, target: "_blank", rel: "noopener" }, "Open the lesson studio")));
}
function applyTheme() {
  if (IN_CLAUDE) return;                       // on claude.ai the viewer's own theme setting wins
  if (D.theme) document.documentElement.dataset.theme = D.theme; else delete document.documentElement.dataset.theme;
}

/* ===================== live content + interface updates (web + Android app) ===================== */
const contentUrl = () => D.contentUrl || CFG.contentUrl || "";
const uiUrl = () => D.uiUrl || CFG.uiUrl || "";
async function checkUpdates() {
  const url = contentUrl();
  if (!url || IN_CLAUDE) return { status: "nourl" };
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const c = await r.json();
    if (!c || !c.sessions || !c.version) return { status: "bad" };
    D.lastCheck = new Date().toISOString(); saveDevice();
    if (c.schema > APP_SCHEMA) return { status: "appold", version: c.version };
    if (c.version > P.version) {
      P = c; applyContent();
      try { localStorage.setItem(CONTENT_KEY, JSON.stringify(c)); } catch (e) {}
      renderAll();
      const notes = ((c.changelog || []).find(x => x.version === c.version) || { notes: [] }).notes;
      toast("Plan updated to v" + c.version + (notes.length ? ": " + notes.join("; ") : ""), 7000);
      return { status: "updated", version: c.version };
    }
    return { status: "current", version: P.version };
  } catch (e) { return { status: "error", error: String(e && e.message || e) }; }
}
async function checkUiUpdate() {
  const url = uiUrl();
  if (!url || IN_CLAUDE) return { status: "nourl" };
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const b = await r.json();
    if (!b || !b.js || !b.css || !b.version || !b.sig) return { status: "bad" };
    const running = window.UI_RUNNING_VERSION || 0;
    let bad = 0; try { bad = +localStorage.getItem("ascendmusic.ui.bad") || 0; } catch (e) {}
    if (b.version <= running || b.version <= bad) return { status: "current", version: running };
    if (!window.__uiVerify || !(await window.__uiVerify(b))) return { status: "unsigned" };
    try { localStorage.setItem("ascendmusic.ui", JSON.stringify(b)); } catch (e) { return { status: "error", error: "storage full" }; }
    toast("New interface ready (v" + b.version + ")", 12000, { label: "Restart", run: () => location.reload() });
    return { status: "updated", version: b.version };
  } catch (e) { return { status: "error", error: String(e && e.message || e) }; }
}

/* ===================== metronome + shared audio ===================== */
let AC = null;
function audio() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === "suspended") AC.resume();
  return AC;
}
const M = { on: false, bpm: 60, beats: 4, sub: 1, next: 0, count: 0, timer: null, taps: [], lock: null };
function metroSheet() {
  const sel = (id, label, opts, val, onch) => [h("label", { for: id }, label),
    h("select", { id, onchange: e => onch(+e.target.value) }, opts.map(([v, l]) => h("option", { value: v, selected: v === val }, l)))];
  return h("div", { class: "sheet", id: "metro-sheet", hidden: true }, h("div", { class: "sheet-in" },
    h("div", { class: "bpm" }, h("b", { class: "num", id: "bpm-val" }, "60"), h("i", {}, "♩ = tempo"), h("div", { class: "beats", id: "beats" })),
    h("input", { type: "range", id: "bpm-range", min: "40", max: "208", step: "1", value: "60", "aria-label": "Tempo", oninput: e => setBpm(+e.target.value) }),
    h("div", { class: "selrow" },
      [-5, -1, 1, 5].map(n => h("button", { class: "btn sm", onclick: () => setBpm(M.bpm + n) }, (n > 0 ? "+" : "−") + Math.abs(n))),
      h("button", { class: "btn sm", onclick: tap }, "Tap"),
      h("button", { class: "btn sm", onclick: () => { setBpm(bpmFor(curWeek())); toast("Week " + curWeek() + " Hanon target"); } }, "Week target")),
    h("div", { class: "selrow" },
      sel("m-beats", "Bar", [[2, "2"], [3, "3"], [4, "4"], [6, "6"]], 4, v => { M.beats = v; drawBeats(); }),
      sel("m-sub", "Subdivision", [[1, "quarters"], [2, "8ths"], [3, "triplets"], [4, "16ths"]], 1, v => { M.sub = v; }),
      h("div", { style: "margin-left:auto;display:flex;gap:8px" },
        h("button", { class: "btn pri", id: "m-start", onclick: () => M.on ? stopMetro() : startMetro() }, "Start"),
        h("button", { class: "btn", onclick: closeMetro }, "Close")))));
}
function openMetro(bpm) {
  if (bpm) setBpm(bpm);
  $("metro-sheet").hidden = false; $("metro-open").setAttribute("aria-expanded", "true");
  $("main").style.paddingBottom = "250px";
}
function closeMetro() {
  $("metro-sheet").hidden = true; $("metro-open").setAttribute("aria-expanded", "false");
  $("main").style.paddingBottom = "";
}
function setBpm(v) {
  M.bpm = Math.max(40, Math.min(208, Math.round(v)));
  $("bpm-val").textContent = M.bpm; $("bpm-range").value = M.bpm; $("metro-label").textContent = M.bpm;
}
function tap() {
  const now = Date.now();
  M.taps = M.taps.filter(t => now - t < 2500).concat(now).slice(-6);
  if (M.taps.length > 1) {
    const gaps = M.taps.slice(1).map((t, i) => t - M.taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg > 250) setBpm(60000 / avg);
  }
}
function drawBeats() { $("beats").replaceChildren(...Array.from({ length: M.beats }, (_, i) => h("div", { class: "beat" + (i === 0 ? " ac" : "") }))); }
function litBeat(i) { [...$("beats").children].forEach((b, j) => b.classList.toggle("lit", j === i)); }
function click(time, strong, weak) {
  const ctx = AC, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "square"; o.frequency.value = strong ? 1600 : weak ? 720 : 1100;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(strong ? .5 : weak ? .16 : .3, time + .001);
  g.gain.exponentialRampToValueAtTime(.0001, time + (strong ? .055 : .035));
  o.connect(g); g.connect(ctx.destination); o.start(time); o.stop(time + .07);
}
function scheduler() {
  while (M.next < AC.currentTime + .12) {
    const idx = M.count % (M.beats * M.sub), isBeat = idx % M.sub === 0, beatNo = Math.floor(idx / M.sub), at = M.next;
    click(at, isBeat && beatNo === 0, !isBeat);
    if (isBeat) setTimeout(() => { if (M.on) litBeat(beatNo); }, Math.max(0, (at - AC.currentTime) * 1000));
    M.next += 60 / M.bpm / M.sub; M.count++;
  }
}
async function startMetro() {
  try { audio(); } catch (e) { toast("No audio available here"); return; }
  M.on = true; M.count = 0; M.next = AC.currentTime + .08;
  M.timer = setInterval(scheduler, 25);
  $("m-start").textContent = "Stop"; $("metro-open").classList.add("on");
  try { M.lock = await navigator.wakeLock.request("screen"); } catch (e) { M.lock = null; }   // keep the screen on at the instrument
}
function stopMetro() {
  M.on = false; clearInterval(M.timer); M.timer = null; litBeat(-1);
  $("m-start").textContent = "Start"; $("metro-open").classList.remove("on");
  if (M.lock) { M.lock.release().catch(() => {}); M.lock = null; }
}

/* ===================== LESSONS ===================== */
const ST = { ready: false, init: null, sample: null, assets: null, db: null, limits: null, lessons: new Map(), open: null,
  pages: [], pageTotal: 0, inst: null, prefill: null, busy: false, ctl: null, status: "", err: "" };
function askLesson(o) {
  if (!IN_CLAUDE) { openExternal(STUDIO_URL); return; }
  ST.prefill = o; ST.open = null; showTab("lessons");
}
function renderLessons() {
  const p = $("panel-lessons");
  if (!IN_CLAUDE) { put(p, studioLinkOut()); return; }
  if (!ST.init) ST.init = initStudio();
  if (!ST.ready) {
    put(p, h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Lesson studio"), h("p", { class: "lede" }, "Connecting to Claude…")));
    ST.init.then(() => { if (TAB === "lessons") renderLessons(); });
    return;
  }
  const doc = ST.open && ST.lessons.get(ST.open);
  put(p, doc ? lessonView(doc) : [studioForm(), lessonList()]);
  if (doc) renderExercises(doc);
}
function studioLinkOut() {
  const ph = phaseOf(curWeek());
  const picks = ["piano", "guitar"].map(i => [i, repPick(ph, i)]).filter(x => x[1]);
  return [
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "Lesson studio"),
      h("div", { class: "sday md", html: "Any song, <em>taught to your week</em>" }),
      h("p", { class: "lede" }, "Type a song, or drop in a photo or PDF of a score you own. Claude builds a lesson around where you are in the plan: the song's form and harmony, the theory it uses, a four-session practice plan, and exercises in real notation you can play back."),
      h("p", { class: "lede" }, "The studio runs in the claude.ai version of Ascend Music, on your Claude plan — no API key, and your lessons stay saved there."),
      h("div", { class: "row" }, h("a", { class: "btn pri", href: STUDIO_URL, target: "_blank", rel: "noopener" }, "Open the lesson studio"))),
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "This phase's repertoire"),
      picks.length ? h("div", { class: "items" }, picks.map(([i, s]) => h("div", { class: "item", style: "grid-template-columns:1fr auto" },
        h("div", {}, h("div", { class: "it" }, s), h("div", { class: "id inst-" + i }, i)),
        h("a", { class: "btn sm", href: STUDIO_URL, target: "_blank", rel: "noopener" }, "Get a lesson"))))
        : h("p", { class: "empty" }, "No picks yet. Choose a repertoire piece for each instrument in Plan, then get a lesson for it here."))
  ];
}
async function initStudio() {
  try {
    ST.sample = await window.claude.use("sample");
    ST.db = await window.claude.use("db");
    ST.assets = await window.claude.use("assets");
    if (ST.sample) ST.limits = await ST.sample.limits().catch(() => null);
    if (ST.db) {
      ST.db.collection("lessons").onSnapshot(snap => {
        ST.lessons = new Map(snap.docs.filter(d => d.exists).map(d => [d.id, clone(d.data())]));
        if (TAB === "lessons" && !ST.busy) renderLessons();
      }, () => {});
    }
  } catch (e) {}
  ST.ready = true;
}
function studioForm() {
  const ph = phaseOf(curWeek());
  const pre = ST.prefill || {};
  const inst = ST.inst || pre.inst || (todayInfo().day || DAYS[0]).inst;
  ST.inst = inst;
  const song = h("input", { id: "st-song", list: "st-lib", placeholder: "e.g. Your Song", autocomplete: "off" });
  const artist = h("input", { id: "st-artist", placeholder: "optional — helps with covers", autocomplete: "off" });
  song.value = pre.song || ""; ST.prefill = null;
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Instrument" }, ["piano", "guitar"].map(i =>
    h("button", { class: i, "aria-pressed": String(i === ST.inst), onclick: e => {
      ST.inst = i; seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      $("st-lib").replaceChildren(...P.library[i].map(s => h("option", { value: s })));
    } }, i)));
  const canImages = !!(ST.limits && ST.limits.images);
  const fileIn = h("input", { type: "file", id: "st-file", multiple: true, hidden: true,
    accept: ["application/pdf", ".pdf"].concat(canImages ? ST.limits.images.mediaTypes : []).join(",") });
  const thumbs = h("div", { class: "thumbs" });
  const drop = h("div", { class: "drop", tabindex: "0", role: "button" }, "Drop a photo or PDF of your score here, or tap to choose");
  const showThumbs = () => {
    thumbs.replaceChildren(...ST.pages.map(b => h("img", { src: URL.createObjectURL(b), alt: "Score page" })));
    if (ST.pages.length) thumbs.append(h("button", { class: "btn sm", onclick: () => { ST.pages = []; ST.pageTotal = 0; showThumbs(); } }, "Remove"));
    drop.textContent = ST.pages.length ? ST.pageTotal + " page" + (ST.pageTotal === 1 ? "" : "s") + (ST.pageTotal > ST.pages.length ? " — Claude reads the first " + ST.pages.length : "") + ". Drop more to add."
      : "Drop a photo or PDF of your score here, or tap to choose";
  };
  const take = async files => {
    if (!canImages) { toast("This view can't send images to Claude"); return; }
    drop.textContent = "Reading…";
    try {
      const r = await prepareScore([...files], Math.min(10, ST.limits.images.maxCount) - ST.pages.length);
      ST.pages = ST.pages.concat(r.images); ST.pageTotal += r.total;
    } catch (e) { toast(e.message || "Couldn't read that file"); }
    showThumbs();
  };
  fileIn.onchange = () => { if (fileIn.files.length) take(fileIn.files); fileIn.value = ""; };
  drop.onclick = () => fileIn.click();
  drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileIn.click(); } };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files.length) take(e.dataTransfer.files); };
  showThumbs();
  const go = h("button", { class: "btn pri", id: "st-go", disabled: ST.busy || !ST.sample }, "Build the lesson");
  go.onclick = () => generate(song.value.trim(), artist.value.trim(), ST.inst);
  const gen = h("div", { class: "gen", id: "st-gen" });
  paintGen(gen);
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, "Lesson studio · week " + curWeek() + ", phase " + ph),
    h("div", { class: "sday md", html: "Any song, <em>taught to your week</em>" }),
    !ST.sample ? h("div", { class: "callout" }, "Claude isn't available in this view, so new lessons can't be built here. Saved lessons still open below.") : null,
    h("div", { class: "studio-form" },
      h("div", { class: "two" },
        h("div", { class: "field" }, h("label", { class: "eyebrow", for: "st-song" }, "Song"), song),
        h("div", { class: "field" }, h("label", { class: "eyebrow", for: "st-artist" }, "Artist"), artist)),
      h("div", { class: "row" }, h("span", { class: "eyebrow" }, "Instrument"), seg),
      canImages ? h("div", { class: "field" }, h("span", { class: "eyebrow" }, "Your score (optional)"), drop, fileIn, thumbs) : null,
      h("datalist", { id: "st-lib" }, P.library[ST.inst].map(s => h("option", { value: s }))),
      h("div", { class: "row" }, go, h("span", { class: "lede small" }, "Runs on your Claude plan · about a minute"))),
    gen);
}
function paintGen(el) {
  el = el || $("st-gen");
  if (!el) return;
  el.replaceChildren();
  if (ST.busy) {
    el.append(h("div", { class: "pbar busy" }, h("i")), h("div", { class: "sub" }, h("span", { id: "st-status" }, ST.status),
      h("button", { class: "btn sm", onclick: () => ST.ctl && ST.ctl.abort() }, "Stop")));
  } else if (ST.err) el.append(h("div", { class: "callout" }, ST.err));
}
function setStatus(s) { ST.status = s; const el = $("st-status"); if (el) el.textContent = s; }
async function prepareScore(files, room) {
  const images = [], accepted = (ST.limits.images.mediaTypes || []);
  let total = 0;
  for (const f of files) {
    if (room - images.length <= 0) { total += f.type === "application/pdf" ? 0 : 1; continue; }
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      const r = await pdfToImages(f, room - images.length);
      images.push(...r.images); total += r.total;
    } else if (accepted.includes(f.type)) { images.push(f); total += 1; }
    else {                                     // e.g. HEIC from a phone: re-encode if the browser can decode it
      try {
        const bmp = await createImageBitmap(f), c = h("canvas", { width: bmp.width, height: bmp.height });
        c.getContext("2d").drawImage(bmp, 0, 0);
        images.push(await new Promise(r => c.toBlob(r, "image/jpeg", .88))); total += 1;
      } catch (e) { throw new Error(f.name + " isn't an image Claude can read — use a JPEG, PNG or PDF."); }
    }
  }
  return { images, total };
}
async function pdfToImages(file, max) {
  await loadScript(LIB.pdfWorker);            // defines the worker in-page, so pdf.js needs no separate worker
  await loadScript(LIB.pdf);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(pdf.numPages, max); i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: Math.min(2.5, 1400 / page.getViewport({ scale: 1 }).width) });
    const c = h("canvas", { width: Math.floor(vp.width), height: Math.floor(vp.height) }), g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    out.push(await new Promise(r => c.toBlob(r, "image/jpeg", .85)));
  }
  return { images: out, total: pdf.numPages };
}
const SHAPE = {
  title: "song title as commonly known", artist: "performer or composer", instrument: "piano or guitar",
  key: "e.g. E♭ major", time: "e.g. 4/4", tempo_bpm: 96, difficulty: "1–5, for this student right now",
  fit: "2–3 sentences: how the song fits where the student is now, and when in the 12 weeks to tackle it",
  public_domain: "true, false, or null if unsure", confidence: "high, medium or low",
  verify: ["anything the student should check by ear or against the score"],
  form: [{ section: "Intro", bars: "1–4, or null", harmony: "chord symbols with Roman numerals", notes: "what happens and what to watch" }],
  theory: [{ concept: "a concept from the student's plan", where: "where this song uses it" }],
  technique: [{ skill: "e.g. stride left hand", how: "how to practise it for this song" }],
  plan: [{ session: 1, minutes: 20, focus: "one line", steps: ["one concrete step"] }],
  exercises: [{ title: "short name", why: "what it builds for this song", tempo_bpm: 80, abc: "X:1\nT:...\nM:4/4\nL:1/8\nQ:1/4=80\nK:C\n..." }],
  improv: "one short paragraph on improvising over the song's progression, or null",
  listening: ["what to listen for in a recording"]
};
function lessonPrompt(o) {
  const w = curWeek(), ph = phaseOf(w), phase = PHASES[ph - 1], th = theoryFor(w), keys = keysCovered(w);
  return [
    "You are an experienced piano and guitar teacher. Write one lesson for one student, as data.",
    "",
    "THE STUDENT",
    P.student,
    "They follow a " + P.weeks + "-week plan with four sessions a week: " + DAYS.map(d => d.short + " " + d.inst).join(", ") + ".",
    "Right now: week " + w + " of " + P.weeks + ", phase " + ph + " (" + phase.name + "). This week's theory: " + th.t + " — " + th.d,
    "Major keys drilled so far: " + (keys.length ? keys.map(pretty).join(", ") : "none yet") + ".",
    "Current " + o.inst + " work this phase: " + phase[o.inst],
    "",
    "THE SONG",
    "\"" + o.song + "\"" + (o.artist ? " by " + o.artist : " (no artist given — use the best-known version)") + ", to be played on " + o.inst + ".",
    o.pages ? "The " + o.pages + " attached image" + (o.pages > 1 ? "s are pages 1–" + o.pages : " is page 1") + " of the student's own copy of the score" +
      (o.total > o.pages ? " (the whole score has " + o.total + " pages)" : "") + ". Base the lesson on this score: read the key, metre, tempo marking and form from it, and cite bar numbers."
      : "No score is attached. Work from what you know of the song, set confidence honestly, and list anything the student should check by ear.",
    "",
    "RULES",
    "- Never reproduce lyrics. Never write out the song's own melody, riffs, solos or accompaniment note for note. The student plays from their own score or a licensed copy; you describe sections, harmony (chord symbols with Roman numerals), rhythm feel and technique in words.",
    "- Notation you write is for original exercises only: scales, arpeggios, chord voicings, rhythm patterns, comping patterns over the song's progression, short improvisation frames — material that builds the skills this song needs. Two to four exercises.",
    "- Tie it to the plan: name which of the student's current concepts the song uses. If it is too hard right now, say so plainly and say which week of the plan to come back to it.",
    "- The practice plan is four sessions of 15–25 minutes, alongside the student's normal plan work, on their " + o.inst + " days.",
    "",
    "OUTPUT",
    "Reply with only one JSON object, no other text, in exactly this shape (the values describe what goes there):",
    JSON.stringify(SHAPE),
    "",
    "ABC notation for each exercise's \"abc\": ABC 2.1, a complete tune beginning X:1 then T:, M:, L:, Q: and K: lines; 2–8 bars; no w: or W: lines. " +
      (o.inst === "piano" ? "Piano: a one-hand exercise is a single voice (use K:<key> clef=bass for left hand); for both hands use V:1 clef=treble and V:2 clef=bass."
        : "Guitar: standard guitar notation in treble clef, written an octave above sounding pitch as usual, so the open low E string is written E, and the range is E, to about c'. Single-note lines or simple chords."),
    "Keep each exercise playable at its tempo_bpm."
  ].join("\n");
}
const arr = v => Array.isArray(v) ? v : [];
const str = (v, max = 2000) => v == null ? "" : String(v).slice(0, max);
function normalizeLesson(r, o) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const L = {
    title: str(r.title, 200) || o.song, artist: str(r.artist, 200) || o.artist, instrument: o.inst,
    key: str(r.key, 60), time: str(r.time, 20), tempo_bpm: Number.isFinite(+r.tempo_bpm) && +r.tempo_bpm > 0 ? Math.round(+r.tempo_bpm) : null,
    difficulty: Math.max(1, Math.min(5, Math.round(+r.difficulty) || 3)), fit: str(r.fit),
    public_domain: r.public_domain === true ? true : r.public_domain === false ? false : null,
    confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
    verify: arr(r.verify).map(x => str(x, 400)).filter(Boolean).slice(0, 8),
    form: arr(r.form).map(f => ({ section: str(f && f.section, 80), bars: f && f.bars != null ? str(f.bars, 40) : "", harmony: str(f && f.harmony, 400), notes: str(f && f.notes, 600) })).filter(f => f.section).slice(0, 16),
    theory: arr(r.theory).map(t => ({ concept: str(t && t.concept, 120), where: str(t && t.where, 400) })).filter(t => t.concept).slice(0, 10),
    technique: arr(r.technique).map(t => ({ skill: str(t && t.skill, 120), how: str(t && t.how, 600) })).filter(t => t.skill).slice(0, 10),
    plan: arr(r.plan).map((s, i) => (s = s || {}, { session: +s.session || i + 1, minutes: +s.minutes || 20, focus: str(s.focus, 200), steps: arr(s.steps).map(x => str(x, 400)).filter(Boolean).slice(0, 8) }))
      .filter(s => s.focus || s.steps.length).slice(0, 6),
    exercises: arr(r.exercises).map(x => ({ title: str(x && x.title, 120), why: str(x && x.why, 400), tempo_bpm: +(x && x.tempo_bpm) || null, abc: str(x && x.abc, 4000) }))
      .filter(x => /^\s*X:/m.test(x.abc) && /^\s*K:/m.test(x.abc)).slice(0, 5),
    improv: r.improv ? str(r.improv, 1500) : "", listening: arr(r.listening).map(x => str(x, 300)).filter(Boolean).slice(0, 6)
  };
  return L.form.length || L.plan.length ? L : null;
}
const SAMPLE_ERR = {
  not_granted: "Claude wasn't allowed for this page. Allow it from the artifact's permissions to build lessons.",
  sampling_disabled: "Claude isn't available on this account.", rate_limited: "Too many requests right now — try again in a few minutes.",
  session_expired: "Your Claude session expired — reload the page and sign in.", image_rejected: "Claude couldn't read one of the score images. Try a clearer photo or a PDF.",
  refused: "Claude declined to write this lesson. Try a different song or leave the score out.", invalid_json: "The lesson came back garbled. Try again.",
  empty_completion: "Claude returned nothing. Try again.", prompt_too_large: "That's too much to send at once — use fewer score pages.",
  images_unavailable: "This view can't send images to Claude. Build the lesson without the score."
};
async function generate(song, artist, inst, from) {
  if (!song) { toast("Type a song title first"); $("st-song") && $("st-song").focus(); return; }
  if (!ST.sample || ST.busy) return;
  ST.busy = true; ST.err = ""; ST.status = "Thinking…"; ST.ctl = new AbortController();
  if (from) { ST.open = null; renderLessons(); }
  const go = $("st-go"); if (go) go.disabled = true;
  paintGen();
  let pages = ST.pages.slice(), total = ST.pageTotal, reuse = [];
  if (from) {                                  // a fresh lesson for the same song reads the same saved score pages
    pages = []; total = 0;
    for (const id of from.scores || []) {
      try { const r = await fetch("/_blob/" + id); if (r.ok) { pages.push(await r.blob()); reuse.push(id); } } catch (e) {}
    }
    if (pages.length) total = from.scorePages || pages.length;
  }
  const t0 = Date.now(), tick = setInterval(() => { if (ST.status.startsWith("Thinking")) setStatus("Thinking… " + Math.round((Date.now() - t0) / 1000) + "s"); }, 1000);
  let raw = null;
  try {
    raw = await ST.sample.json(lessonPrompt({ song, artist, inst, pages: pages.length, total }), {
      images: pages.length ? pages : undefined, modelTier: "complex", cache: false, signal: ST.ctl.signal,
      onText: ({ text }) => setStatus("Writing the lesson… " + text.length.toLocaleString() + " characters")
    });
  } catch (e) {
    clearInterval(tick); ST.busy = false;
    ST.err = e && e.code === "cancelled" ? "" : (SAMPLE_ERR[e && e.code] || "Something went wrong building the lesson. Try again.");
    renderLessons(); return;
  }
  clearInterval(tick);
  const lesson = normalizeLesson(raw, { song, artist, inst });
  if (!lesson) { ST.busy = false; ST.err = SAMPLE_ERR.invalid_json; renderLessons(); return; }
  setStatus("Saving…");
  const scores = reuse.slice();
  if (!reuse.length && pages.length && ST.assets) {
    for (const b of pages) {
      try { scores.push((await ST.assets.upload(b, { type: b.type || "image/jpeg" })).id); } catch (e) { break; }
    }
  }
  const id = "l" + Date.now().toString(36);
  const w = curWeek();
  const doc = { id, song: lesson.title, artist: lesson.artist, inst, createdAt: Date.now(), week: w, phase: phaseOf(w),
    lesson, scores, scorePages: total, progress: {} };
  ST.lessons.set(id, doc);
  if (ST.db) { try { await ST.db.collection("lessons").doc(id).set(doc); } catch (e) { toast("Couldn't save the lesson to your account — it stays open until you reload."); } }
  ST.busy = false; ST.open = id; ST.pages = []; ST.pageTotal = 0;
  renderLessons(); window.scrollTo({ top: 0 });
}
function lessonList() {
  const list = [...ST.lessons.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, "Your lessons"),
    list.length ? h("div", { class: "items" }, list.map(d => h("button", { class: "lcard", type: "button", onclick: () => { ST.open = d.id; renderLessons(); window.scrollTo({ top: 0 }); } },
      h("span", { class: "stripe " + d.inst }),
      h("span", {}, h("span", { class: "t" }, d.song), h("span", { class: "s" }, [d.artist, d.inst, (d.lesson && d.lesson.key) || ""].filter(Boolean).join(" · "))),
      dots(d.lesson && d.lesson.difficulty))))
      : h("p", { class: "empty" }, "No lessons yet. Build one above — it's saved here, with its practice plan and exercises."));
}
const dots = n => h("span", { class: "dots", title: "Difficulty " + (n || "?") + " of 5", "aria-label": "Difficulty " + (n || "?") + " of 5" },
  [1, 2, 3, 4, 5].map(i => h("i", { class: i <= (n || 0) ? "on" : "" })));
function q(s) { return encodeURIComponent(s).replace(/%20/g, "+"); }
function lessonView(d) {
  const L = d.lesson, query = [d.song, d.artist].filter(Boolean).join(" ");
  const facts = [L.key, L.time, L.tempo_bpm ? "♩ = " + L.tempo_bpm : ""].filter(Boolean);
  const progress = d.progress || {};
  let progTimer = null;
  const saveProgress = () => {
    clearTimeout(progTimer);
    progTimer = setTimeout(() => { if (ST.db) ST.db.collection("lessons").doc(d.id).update({ progress: d.progress }).catch(() => {}); }, 600);
  };
  return [
    h("div", { class: "card" },
      h("div", { class: "row" }, h("button", { class: "btn sm", onclick: () => { ST.open = null; renderLessons(); } }, "← All lessons"),
        h("span", { class: "eyebrow", style: "margin-left:auto" }, d.inst + " lesson · built in week " + (d.week || "?"))),
      h("div", { class: "shead" }, h("div", { class: "sday" }, L.title), h("div", { class: "sub" }, L.artist || "")),
      h("div", { class: "facts" }, facts.map(f => h("span", { class: "fact" }, f)), h("span", { class: "fact" }, "difficulty ", dots(L.difficulty))),
      L.fit ? h("p", { class: "lede" }, L.fit) : null,
      (L.confidence !== "high" || L.verify.length) ? h("div", { class: "callout" },
        h("strong", {}, d.scores && d.scores.length ? "Check against your score" : "Check these by ear"),
        L.verify.length ? h("ul", {}, L.verify.map(v => h("li", {}, v))) : h("div", {}, "Claude was " + L.confidence + "-confidence about this song's details.")) : null),
    h("div", { class: "card" },
      h("div", { class: "eyebrow" }, "Sheet music"),
      d.scores && d.scores.length ? [h("p", { class: "lede" }, "Your copy" + (d.scorePages > d.scores.length ? " — the first " + d.scores.length + " of " + d.scorePages + " pages" : "") + ":"),
        h("div", { class: "thumbs big" }, d.scores.map(id => h("a", { href: "/_blob/" + id, target: "_blank", rel: "noopener" }, h("img", { src: "/_blob/" + id, alt: "Score page", loading: "lazy" }))))]
        : h("p", { class: "lede" }, L.public_domain === true ? "This piece is in the public domain — the free score is on IMSLP." : "Use a copy you own or a licensed score. Drop a photo or PDF into a new lesson and Claude will cite bar numbers from it."),
      h("div", { class: "links" },
        L.public_domain === true ? h("a", { class: "btn sm", href: "https://imslp.org/index.php?title=Special:Search&search=" + q(query), target: "_blank", rel: "noopener" }, "Free score · IMSLP") : null,
        h("a", { class: "btn sm", href: "https://www.musicnotes.com/search/go?q=" + q(query), target: "_blank", rel: "noopener" }, "Licensed · Musicnotes"),
        h("a", { class: "btn sm", href: "https://musescore.com/sheetmusic?text=" + q(query), target: "_blank", rel: "noopener" }, "MuseScore"),
        d.inst === "guitar" ? h("a", { class: "btn sm", href: "https://www.ultimate-guitar.com/search.php?search_type=title&value=" + q(query), target: "_blank", rel: "noopener" }, "Ultimate Guitar") : null)),
    L.form.length ? h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Form and harmony"),
      h("div", { class: "tscroll", html: "<table><thead><tr><th>Section</th><th>Bars</th><th>Harmony</th><th>Notes</th></tr></thead><tbody>" +
        L.form.map(f => "<tr><td><strong>" + esc(f.section) + "</strong></td><td class=\"n\">" + esc(f.bars || "") + "</td><td>" + esc(f.harmony) + "</td><td>" + esc(f.notes) + "</td></tr>").join("") +
        "</tbody></table>" })) : null,
    L.plan.length ? h("div", { class: "card" }, h("div", { class: "eyebrow" }, L.plan.length + (L.plan.length === 1 ? " session" : " sessions") + " with this song"),
      h("div", { class: "items" }, L.plan.map((s, i) => {
        const k = "s" + (i + 1);
        const row = h("button", { class: "item" + (progress[k] ? " done" : ""), type: "button" }, h("div", { class: "box", html: TICK }),
          h("div", {}, h("div", { class: "it" }, "Session " + s.session + " · " + s.focus + " ", h("span", { class: "num", style: "color:var(--ink-faint)" }, s.minutes + " min")),
            s.steps.length ? h("ul", { class: "list id" }, s.steps.map(x => h("li", {}, x))) : null));
        row.onclick = () => { d.progress = d.progress || {}; d.progress[k] = !d.progress[k]; row.classList.toggle("done", d.progress[k]); if (d.progress[k]) haptic(); saveProgress(); };
        return row;
      }))) : null,
    L.exercises.length ? h("div", { class: "card", id: "ex-card" }, h("div", { class: "eyebrow" }, "Exercises"),
      L.exercises.map((x, i) => h("div", { class: "ex" },
        h("div", { class: "ex-h" }, h("b", {}, x.title), x.tempo_bpm ? h("span", { class: "num" }, "♩ = " + x.tempo_bpm) : null,
          h("button", { class: "btn sm", id: "ex-play-" + i, disabled: true, style: "margin-left:auto" }, "Play")),
        x.why ? h("div", { class: "lede" }, x.why) : null,
        h("div", { class: "score", id: "ex-score-" + i }, h("div", { class: "lede", style: "color:var(--sheet-ink)" }, "Loading notation…"))))) : null,
    (L.theory.length || L.technique.length || L.improv || L.listening.length) ? h("div", { class: "card" },
      L.theory.length ? [h("div", { class: "eyebrow" }, "Theory it uses"), h("div", { class: "kv", style: "grid-template-columns:auto 1fr;gap:6px 14px" },
        L.theory.map(t => [h("div", { style: "font-weight:600" }, t.concept), h("div", { class: "lede" }, t.where)]))] : null,
      L.technique.length ? [h("div", { class: "eyebrow" }, "Technique"), h("div", { class: "kv", style: "grid-template-columns:auto 1fr;gap:6px 14px" },
        L.technique.map(t => [h("div", { style: "font-weight:600" }, t.skill), h("div", { class: "lede" }, t.how)]))] : null,
      L.improv ? [h("div", { class: "eyebrow" }, "Improvising over it"), h("p", { class: "lede" }, L.improv)] : null,
      L.listening.length ? [h("div", { class: "eyebrow" }, "Listen for"), h("ul", { class: "list lede" }, L.listening.map(x => h("li", {}, x)))] : null) : null,
    h("div", { class: "card" }, h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => {
        const ph = phaseOf(curWeek()); S.rep[ph + "-" + d.inst] = d.song; save(); renderToday(); renderPlan();
        toast(d.song + " is now your phase " + ph + " " + d.inst + " pick");
      } }, "Make it this phase's repertoire pick"),
      ST.sample ? h("button", { class: "btn", onclick: () => generate(d.song, d.artist, d.inst, d) }, "Build a fresh lesson") : null,
      armed(h("button", { class: "btn" }, "Delete"), "Tap again to delete", async () => {
        ST.lessons.delete(d.id); ST.open = null; renderLessons();
        if (ST.db) ST.db.collection("lessons").doc(d.id).delete().catch(() => {});
        const stillUsed = new Set([...ST.lessons.values()].flatMap(x => x.scores || []));
        if (ST.assets) for (const id of d.scores || []) if (!stillUsed.has(id)) ST.assets.delete(id).catch(() => {});
        toast("Lesson deleted");
      })))
  ];
}
async function renderExercises(d) {
  const L = d.lesson;
  if (!L.exercises.length) return;
  try { await loadScript(LIB.abcjs); } catch (e) {
    L.exercises.forEach((_, i) => { const el = $("ex-score-" + i); if (el) el.replaceChildren(h("div", { class: "lede", style: "color:var(--sheet-ink)" }, "Notation couldn't load — check your connection.")); });
    return;
  }
  L.exercises.forEach((x, i) => {
    const el = $("ex-score-" + i), btn = $("ex-play-" + i);
    if (!el || ST.open !== d.id) return;
    el.replaceChildren();
    let tune = null;
    try {
      tune = window.ABCJS.renderAbc(el, x.abc, { responsive: "resize", add_classes: true, foregroundColor: "#15171c",
        paddingtop: 4, paddingbottom: 4, paddingleft: 4, paddingright: 4,
        tablature: d.inst === "guitar" ? [{ instrument: "guitar", label: "Guitar" }] : undefined })[0];
    } catch (e) { tune = null; }
    if (!tune || !el.querySelector("svg")) { el.replaceChildren(h("div", { class: "lede", style: "color:var(--sheet-ink)" }, "This exercise's notation didn't parse.")); return; }
    if (btn) { btn.disabled = false; btn.onclick = () => playTune(tune, btn, d.inst === "guitar" ? -12 : 0, x.tempo_bpm); }
  });
}
/* exercise playback: abcjs gives the note events, a small synth plays them (no sound-font downloads needed) */
const PLAY = { nodes: [], btn: null, timer: null };
function stopTune() {
  for (const n of PLAY.nodes) { try { n.stop(); } catch (e) {} }
  PLAY.nodes = []; clearTimeout(PLAY.timer);
  if (PLAY.btn) PLAY.btn.textContent = "Play";
  PLAY.btn = null;
}
function playTune(tune, btn, transpose, bpm) {
  if (PLAY.btn === btn) { stopTune(); return; }
  stopTune();
  let seq, ctx;
  try { seq = tune.setUpAudio(); ctx = audio(); } catch (e) { toast("Couldn't play this exercise"); return; }
  let secPerWhole = 240 / (bpm || seq.tempo || 90);    // fallback: tempo as quarter notes per minute
  try {                                                // preferred: the tune's own Q: line and metre
    const ms = tune.millisecondsPerMeasure(), m = tune.getMeterFraction();
    if (ms > 0 && m && m.num && m.den) secPerWhole = ms / 1000 / (m.num / m.den);
  } catch (e) {}
  const t0 = ctx.currentTime + .1;
  let end = t0;
  for (const track of seq.tracks || []) for (const ev of track) {
    if (ev.cmd !== "note" || typeof ev.pitch !== "number") continue;
    const at = t0 + ev.start * secPerWhole, dur = Math.max(.06, ev.duration * secPerWhole * .95);
    const freq = 440 * Math.pow(2, (ev.pitch + transpose - 69) / 12), vol = Math.min(1, (ev.volume || 85) / 127) * .22;
    for (const [type, mult, gain] of [["triangle", 1, 1], ["sine", 2, .25]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq * mult;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol * gain, at + .008);
      g.gain.exponentialRampToValueAtTime(vol * gain * .35, at + Math.min(dur, .35)); g.gain.exponentialRampToValueAtTime(.0001, at + dur + .08);
      o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + dur + .1);
      PLAY.nodes.push(o);
    }
    end = Math.max(end, at + dur + .1);
  }
  if (!PLAY.nodes.length) { toast("This exercise has no notes to play"); return; }
  PLAY.btn = btn; btn.textContent = "Stop";
  PLAY.timer = setTimeout(stopTune, (end - ctx.currentTime) * 1000 + 50);
}

/* ===================== boot ===================== */
function renderAll() {
  const info = todayInfo();
  $("hdr-week").textContent = info.week < 1 ? "Starts " + shortDate(parseISO(S.startDate)) : info.week > P.weeks ? "Done" : "Week " + info.week;
  renderToday(); renderPlan(); renderTheory(); renderProgress();
  if (TAB === "lessons") renderLessons();
}
async function initDb() {
  try {
    const db = await window.claude.use("db");
    if (!db) { setSync("device"); return; }
    SYNC.doc = db.doc("state/main");
    let first = true;
    SYNC.doc.onSnapshot(snap => {
      const remote = snap.exists ? clone(snap.data() || {}) : null;
      const newerHere = (S.updatedAt || 0) > ((remote && remote.updatedAt) || 0);
      if (first) {                             // one reconciliation on load: push edits made while away; never write from later snapshots
        first = false;
        if (newerHere) { queueDb(); return; }
      }
      if (remote && remote.updatedAt > (S.updatedAt || 0)) {
        adopt(remote);
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
        renderAll();
      }
      if (!snap.metadata.hasPendingWrites && !newerHere) setSync("synced");
    }, () => setSync("device"));
  } catch (e) { setSync("device"); }
}
function boot() {
  applyTheme();
  buildShell();
  drawBeats();
  setBpm(bpmFor(curWeek()));
  const hash = (location.hash || "").slice(1);
  if (TABS.includes(hash)) TAB = hash;
  renderAll();
  showTab(TAB);
  try { localStorage.removeItem("ascendmusic.ui.pending"); } catch (e) {}   // this interface started fine

  if (IN_CLAUDE) { initDb(); return; }

  /* durable storage: if the WebView's own storage was wiped, restore from the native copy (once) */
  (async () => {
    const Pref = plug("Preferences");
    if (!Pref) return;
    try {
      if (!localStorage.getItem(KEY) && !sessionStorage.getItem("ascendmusic.restored")) {
        const r = await Pref.get({ key: "state" });
        if (r && r.value) { localStorage.setItem(KEY, r.value); sessionStorage.setItem("ascendmusic.restored", "1"); location.reload(); return; }
      }
      mirror();
      if (D.reminders && D.reminders.on) applyReminders();
    } catch (e) {}
  })();
  /* live updates: on launch, and when the app comes back to the foreground (at most every 30 min) */
  const autoCheck = () => {
    if (D.lastCheck && Date.now() - new Date(D.lastCheck).getTime() < 30 * 60 * 1000) return;
    if (navigator.onLine === false) return;
    checkUpdates(); checkUiUpdate();
  };
  setTimeout(autoCheck, 1200);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { autoCheck(); renderAll(); } });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !NATIVE) navigator.serviceWorker.register("sw.js").catch(() => {});
}

window.AscendMusic = { sessionItems, diatonic, weekIndex, dateOf, nextSessionFrom, normalizeLesson, lessonPrompt, get S() { return S; } };   // for debugging
if (document.getElementById("app")) boot();
})();
