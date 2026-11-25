import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, DEFAULT_EVENT } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export const GENERAL = "all";

/** Zajistí přihlášení. Pokud nikdo přihlášen není, přihlásí anonymně (bez jakýchkoli údajů). */
export function ensureUser() {
  return new Promise((resolve, reject) => {
    let started = false;
    onAuthStateChanged(auth, (user) => {
      if (user) { resolve(user); return; }
      if (started) return;
      started = true;
      signInAnonymously(auth).catch(reject);
    });
  });
}

/** Malý pomocník pro tvorbu prvků. Text se vždy vkládá přes textContent. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "právě teď";
  const m = Math.round(s / 60);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  return new Date(ts).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function clockTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }) : "";
}

export function eventWithDefaults(ev) {
  return { ...DEFAULT_EVENT, ...(ev || {}) };
}

/** Seřazené adresáty: [{id, name, note, order}] */
export function sortedTargets(targets) {
  return Object.entries(targets || {})
    .map(([id, t]) => ({ id, name: t.name || "", note: t.note || "", order: t.order ?? 0 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "cs"));
}

export function targetName(targets, id) {
  if (!id || id === GENERAL) return "Všem";
  return targets?.[id]?.name || "Neznámý adresát";
}

export function voteCount(votes, qid) {
  return votes?.[qid] ? Object.keys(votes[qid]).length : 0;
}

/** Adresa studentské stránky (index.html ve stejné složce). */
export function studentUrl() {
  return new URL("./", location.href).href;
}

/** Bezpečný přístup k localStorage (v některých prohlížečích může selhat). */
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignorovat */ }
  }
};

/** QR kód jako SVG řetězec (knihovna qrcode-generator, vendor/qrcode.js). */
export function qrSvg(text, cellSize = 6, margin = 2) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}

export function qrDataUrl(text, cellSize = 12, margin = 3) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, margin);
}

export function toast(message, kind = "ok") {
  let box = document.getElementById("toast");
  if (!box) {
    box = el("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.append(box);
  }
  box.textContent = message;
  box.className = `toast show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { box.className = `toast ${kind}`; }, 3200);
}
