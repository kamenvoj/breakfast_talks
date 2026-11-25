import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref, onValue, off, update, set, push, get, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  auth, db, el, timeAgo, clockTime, eventWithDefaults, sortedTargets, targetName,
  voteCount, studentUrl, qrSvg, qrDataUrl, toast, store, GENERAL
} from "./common.js";
import { DEFAULT_EVENT, POSTER_GUESTS } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);

const state = {
  event: eventWithDefaults(null),
  targets: {},
  questions: {},
  votes: {},
  hidden: {},
  queue: {},
  projection: { mode: "idle" },
  filter: store.get("bt_mod_filter", { target: "*", status: "open", sort: "votes", search: "" }),
  subs: []
};

/* =========================================================
   Přihlášení
   ========================================================= */
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-err").hidden = true;
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-pass").value);
  } catch (err) {
    console.error(err);
    showLoginError("Přihlášení se nepovedlo. Zkontrolujte e-mail a heslo.");
  }
});

$("logout").addEventListener("click", () => signOut(auth));

function showLoginError(msg) {
  $("login-err").textContent = msg;
  $("login-err").hidden = false;
}

function showLogin() {
  unsubscribeAll();
  $("app").hidden = true;
  $("login").hidden = false;
}

onAuthStateChanged(auth, async (user) => {
  if (!user || user.isAnonymous) { showLogin(); return; }
  // Ověření oprávnění: číst skryté otázky smí jen moderátor.
  try {
    await get(ref(db, "hidden"));
  } catch {
    showLoginError("Tento účet nemá oprávnění moderátora.");
    await signOut(auth);
    return;
  }
  $("login").hidden = true;
  $("app").hidden = false;
  await ensureEventConfig();
  subscribeAll();
});

async function ensureEventConfig() {
  try {
    const snap = await get(ref(db, "config/event"));
    if (!snap.exists()) await set(ref(db, "config/event"), DEFAULT_EVENT);
  } catch (err) { console.error(err); }
}

function sub(path, fn) {
  const r = ref(db, path);
  onValue(r, (s) => fn(s.val()), (err) => { console.error(path, err); toast(`Chyba načítání (${path})`, "error"); });
  state.subs.push(r);
}

function unsubscribeAll() {
  state.subs.forEach((r) => off(r));
  state.subs = [];
}

function subscribeAll() {
  unsubscribeAll();
  sub("config/event", (v) => { state.event = eventWithDefaults(v); renderEvent(); });
  sub("config/targets", (v) => { state.targets = v || {}; renderTargets(); renderAll(); });
  sub("questions", (v) => { state.questions = v || {}; renderAll(); });
  sub("votes", (v) => { state.votes = v || {}; renderAll(); });
  sub("hidden", (v) => { state.hidden = v || {}; renderHidden(); });
  sub("queue", (v) => { state.queue = v || {}; renderAll(); });
  sub("projection", (v) => { state.projection = v || { mode: "idle" }; renderAll(); });
}

/* =========================================================
   Záložky
   ========================================================= */
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
  $("tab-questions").hidden = t.dataset.tab !== "questions";
  $("tab-settings").hidden = t.dataset.tab !== "settings";
}));

/* =========================================================
   Operace s daty
   ========================================================= */
async function run(promise, okMsg) {
  try { await promise; if (okMsg) toast(okMsg); }
  catch (err) { console.error(err); toast("Operace se nepovedla.", "error"); }
}

function queueList() {
  return Object.entries(state.queue)
    .filter(([id]) => state.questions[id])
    .map(([id, v]) => ({ id, order: v.order ?? 0 }))
    .sort((a, b) => a.order - b.order)
    .map((x) => x.id);
}

function addToQueue(qid) {
  const max = Math.max(0, ...Object.values(state.queue).map((v) => v.order ?? 0));
  run(set(ref(db, `queue/${qid}`), { order: max + 1 }));
}

function removeFromQueue(qid) {
  run(set(ref(db, `queue/${qid}`), null));
}

function writeQueueOrder(ids) {
  const upd = {};
  ids.forEach((id, i) => { upd[`queue/${id}/order`] = i + 1; });
  run(update(ref(db), upd));
}

function moveInQueue(qid, delta) {
  const ids = queueList();
  const i = ids.indexOf(qid);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  writeQueueOrder(ids);
}

function setAsked(qid, asked) {
  run(update(ref(db, `questions/${qid}`), asked
    ? { asked: true, askedAt: serverTimestamp() }
    : { asked: null, askedAt: null }));
}

function project(mode, current = null) {
  return run(set(ref(db, "projection"), { mode, current, updatedAt: serverTimestamp() }));
}

function hideQuestion(qid) {
  const q = state.questions[qid];
  if (!q) return;
  const upd = {
    [`hidden/${qid}`]: q,
    [`questions/${qid}`]: null,
    [`queue/${qid}`]: null
  };
  if (state.projection.current === qid) upd.projection = { mode: "idle", current: null };
  run(update(ref(db), upd), "Otázka skryta.");
}

function restoreQuestion(qid) {
  const q = state.hidden[qid];
  if (!q) return;
  run(update(ref(db), { [`questions/${qid}`]: q, [`hidden/${qid}`]: null }), "Otázka vrácena.");
}

function deleteQuestion(qid) {
  const q = state.questions[qid] || state.hidden[qid];
  const preview = q?.text ? `\n\n„${q.text.slice(0, 120)}${q.text.length > 120 ? "…" : ""}“` : "";
  if (!confirm(`Opravdu otázku natrvalo smazat?${preview}`)) return;
  const upd = {
    [`questions/${qid}`]: null,
    [`hidden/${qid}`]: null,
    [`votes/${qid}`]: null,
    [`authors/${qid}`]: null,
    [`queue/${qid}`]: null
  };
  if (state.projection.current === qid) upd.projection = { mode: "idle", current: null };
  run(update(ref(db), upd), "Otázka smazána.");
}

/* ---------- ovládání projekce ---------- */
$("proj-idle").addEventListener("click", () => project("idle"));
$("proj-queue").addEventListener("click", () => project("queue"));
$("proj-blank").addEventListener("click", () => project("blank"));

$("proj-next").addEventListener("click", async () => {
  const cur = state.projection.current;
  const ids = queueList();
  if (cur && state.questions[cur] && !state.questions[cur].asked) {
    await run(update(ref(db, `questions/${cur}`), { asked: true, askedAt: serverTimestamp() }));
  }
  const i = ids.indexOf(cur);
  const after = ids.slice(i + 1).find((id) => !state.questions[id]?.asked && id !== cur);
  const any = ids.find((id) => !state.questions[id]?.asked && id !== cur);
  const next = after || any;
  if (next) project("question", next);
  else { project("idle"); toast("Ve frontě už nejsou žádné nepoložené otázky."); }
});

$("proj-prev").addEventListener("click", () => {
  const ids = queueList();
  const i = ids.indexOf(state.projection.current);
  if (i > 0) project("question", ids[i - 1]);
  else toast("Tohle je první otázka ve frontě.");
});

$("queue-clean").addEventListener("click", () => {
  const upd = {};
  queueList().forEach((id) => { if (state.questions[id]?.asked) upd[`queue/${id}`] = null; });
  if (!Object.keys(upd).length) { toast("Ve frontě nejsou žádné položené otázky."); return; }
  run(update(ref(db), upd));
});

/* =========================================================
   Filtry
   ========================================================= */
function saveFilter() { store.set("bt_mod_filter", state.filter); renderAll(); }
$("f-status").value = state.filter.status;
$("f-sort").value = state.filter.sort;
$("f-search").value = state.filter.search || "";
$("f-target").addEventListener("change", (e) => { state.filter.target = e.target.value; saveFilter(); });
$("f-status").addEventListener("change", (e) => { state.filter.status = e.target.value; saveFilter(); });
$("f-sort").addEventListener("change", (e) => { state.filter.sort = e.target.value; saveFilter(); });
$("f-search").addEventListener("input", (e) => { state.filter.search = e.target.value; saveFilter(); });

/* =========================================================
   Vykreslení – otázky a fronta
   ========================================================= */
function targetPill(q) {
  const general = (q.target || GENERAL) === GENERAL;
  return el("span", { class: `tpill${general ? " general" : ""}`, text: general ? "Všem" : targetName(state.targets, q.target) });
}

function questionItem(qid, q, inQueuePos) {
  const votes = voteCount(state.votes, qid);
  const isNew = q.createdAt && Date.now() - q.createdAt < 3 * 60 * 1000;
  const onScreen = state.projection.mode === "question" && state.projection.current === qid;
  return el("li", { class: `qi${q.asked ? " asked" : ""}${onScreen ? " onscreen" : ""}` },
    el("div", { class: "qi-meta" },
      targetPill(q),
      el("span", { class: "votes", title: "Počet hlasů", text: `▲ ${votes}` }),
      el("span", { class: "muted", title: timeAgo(q.createdAt), text: clockTime(q.createdAt) }),
      isNew && !q.asked ? el("span", { class: "badge new", text: "NOVÁ" }) : null,
      q.asked ? el("span", { class: "badge asked", text: `✓ Položeno ${clockTime(q.askedAt)}` }) : null,
      inQueuePos ? el("span", { class: "badge queued", text: `Ve frontě #${inQueuePos}` }) : null,
      onScreen ? el("span", { class: "badge screen", text: "Na plátně" }) : null
    ),
    el("p", { class: "qi-text", text: q.text }),
    el("div", { class: "qi-actions" },
      inQueuePos
        ? el("button", { class: "btn small", onclick: () => removeFromQueue(qid), text: "Odebrat z fronty" })
        : el("button", { class: "btn small primary", onclick: () => addToQueue(qid), text: "+ Do fronty" }),
      el("button", { class: "btn small", onclick: () => setAsked(qid, !q.asked), text: q.asked ? "↺ Nepoloženo" : "✓ Položeno" }),
      el("button", { class: "btn small", onclick: () => project("question", qid), text: "Promítnout" }),
      el("span", { class: "spacer" }),
      el("button", { class: "btn small ghost", onclick: () => hideQuestion(qid), text: "Skrýt" }),
      el("button", { class: "btn small ghost danger-text", onclick: () => deleteQuestion(qid), text: "Smazat" })
    )
  );
}

let dragId = null;

function queueItem(qid, q, pos) {
  const votes = voteCount(state.votes, qid);
  const onScreen = state.projection.mode === "question" && state.projection.current === qid;
  const li = el("li", {
    class: `qi queue-item${q.asked ? " asked" : ""}${onScreen ? " onscreen" : ""}`,
    draggable: "true",
    dataset: { id: qid }
  },
    el("div", { class: "qnum", text: pos }),
    el("div", { class: "qbody" },
      el("div", { class: "qi-meta" },
        targetPill(q),
        el("span", { class: "votes", text: `▲ ${votes}` }),
        onScreen ? el("span", { class: "badge screen", text: "Na plátně" }) : null
      ),
      el("p", { class: "qi-text", text: q.text }),
      el("div", { class: "qi-actions" },
        el("label", { class: "check-asked" },
          el("input", { type: "checkbox", checked: !!q.asked, onchange: (e) => setAsked(qid, e.target.checked) }),
          " Položeno"
        ),
        el("button", { class: "btn small", onclick: () => project("question", qid), text: "Promítnout" }),
        el("span", { class: "spacer" }),
        el("button", { class: "btn small icon", title: "Posunout výš", "aria-label": "Posunout výš", onclick: () => moveInQueue(qid, -1), text: "↑" }),
        el("button", { class: "btn small icon", title: "Posunout níž", "aria-label": "Posunout níž", onclick: () => moveInQueue(qid, 1), text: "↓" }),
        el("button", { class: "btn small icon ghost", title: "Odebrat z fronty", "aria-label": "Odebrat z fronty", onclick: () => removeFromQueue(qid), text: "✕" })
      )
    )
  );
  li.addEventListener("dragstart", (e) => {
    dragId = qid;
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", qid); } catch { /* ignorovat */ }
  });
  li.addEventListener("dragend", () => { dragId = null; li.classList.remove("dragging"); clearDropMarks(); });
  li.addEventListener("dragover", (e) => {
    if (!dragId || dragId === qid) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    clearDropMarks();
    li.classList.add(before ? "drop-before" : "drop-after");
  });
  li.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragId || dragId === qid) return;
    const r = li.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    const ids = queueList().filter((id) => id !== dragId);
    const idx = ids.indexOf(qid) + (before ? 0 : 1);
    ids.splice(idx, 0, dragId);
    clearDropMarks();
    writeQueueOrder(ids);
  });
  return li;
}

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
}

function renderAll() {
  if ($("app").hidden) return;
  const qs = state.questions;
  const ids = Object.keys(qs);
  const qOrder = queueList();
  const qPos = Object.fromEntries(qOrder.map((id, i) => [id, i + 1]));

  // statistiky
  const totalVotes = ids.reduce((s, id) => s + voteCount(state.votes, id), 0);
  const asked = ids.filter((id) => qs[id].asked).length;
  $("stats").textContent = `${ids.length} otázek · ${totalVotes} hlasů · ${asked} položeno`;

  // filtr adresátů s počty
  const counts = {};
  ids.forEach((id) => { const t = qs[id].target || GENERAL; counts[t] = (counts[t] || 0) + 1; });
  const fT = $("f-target");
  fT.replaceChildren(
    el("option", { value: "*", text: `Všichni adresáti (${ids.length})` }),
    el("option", { value: GENERAL, text: `Všem – obecné (${counts[GENERAL] || 0})` }),
    ...sortedTargets(state.targets).map((t) => el("option", { value: t.id, text: `${t.name} (${counts[t.id] || 0})` }))
  );
  fT.value = [...fT.options].some((o) => o.value === state.filter.target) ? state.filter.target : "*";

  // seznam všech otázek
  const { target, status, sort } = state.filter;
  const search = (state.filter.search || "").trim().toLowerCase();
  let items = ids.map((id) => ({ id, q: qs[id], v: voteCount(state.votes, id) }));
  if (target !== "*") items = items.filter((x) => (x.q.target || GENERAL) === target);
  if (status === "open") items = items.filter((x) => !x.q.asked);
  if (status === "notqueued") items = items.filter((x) => !x.q.asked && !qPos[x.id]);
  if (status === "asked") items = items.filter((x) => x.q.asked);
  if (search) items = items.filter((x) => (x.q.text || "").toLowerCase().includes(search));
  const byNew = (a, b) => (b.q.createdAt || 0) - (a.q.createdAt || 0);
  if (sort === "votes") items.sort((a, b) => b.v - a.v || byNew(a, b));
  if (sort === "new") items.sort(byNew);
  if (sort === "old") items.sort((a, b) => -byNew(a, b));

  $("all-count").textContent = `(${items.length})`;
  $("all-empty").hidden = items.length > 0;
  $("all-list").replaceChildren(...items.map((x) => questionItem(x.id, x.q, qPos[x.id])));

  // fronta
  $("queue-count").textContent = qOrder.length ? `(${qOrder.filter((id) => !qs[id].asked).length} zbývá z ${qOrder.length})` : "";
  $("queue-empty").hidden = qOrder.length > 0;
  $("queue-list").replaceChildren(...qOrder.map((id, i) => queueItem(id, qs[id], i + 1)));

  renderProjectionState();
}

function renderProjectionState() {
  const p = state.projection || {};
  let txt = "Úvod + QR";
  if (p.mode === "queue") txt = "Fronta otázek";
  if (p.mode === "blank") txt = "Skryto (prázdné plátno)";
  if (p.mode === "question") {
    const q = state.questions[p.current];
    txt = q ? `Otázka: ${q.text.slice(0, 60)}${q.text.length > 60 ? "…" : ""}` : "Otázka (už neexistuje)";
  }
  $("proj-state").textContent = txt;
  $("proj-q-ctrl").hidden = p.mode !== "question";
  ["proj-idle", "proj-queue", "proj-blank"].forEach((id) => $(id).classList.remove("active"));
  if (p.mode === "idle" || !p.mode) $("proj-idle").classList.add("active");
  if (p.mode === "queue") $("proj-queue").classList.add("active");
  if (p.mode === "blank") $("proj-blank").classList.add("active");
}

/* =========================================================
   Nastavení – akce
   ========================================================= */
function renderEvent() {
  const ev = state.event;
  $("ev-name").textContent = ev.title || "Otázky";
  const pill = $("status-open");
  pill.textContent = ev.open ? "● Příjem otázek otevřen" : "● Příjem otázek uzavřen";
  pill.className = `pill ${ev.open ? "ok" : "closed"}`;
  pill.title = "Kliknutím přepnete";
  if (document.activeElement?.closest?.("#event-form")) return; // nepřepisovat rozepsaný formulář
  $("ev-kicker").value = ev.kicker || "";
  $("ev-title").value = ev.title || "";
  $("ev-subtitle").value = ev.subtitle || "";
  $("ev-open").checked = !!ev.open;
}

$("status-open").addEventListener("click", () => {
  run(update(ref(db, "config/event"), { open: !state.event.open }));
});

$("event-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(set(ref(db, "config/event"), {
    kicker: $("ev-kicker").value.trim(),
    title: $("ev-title").value.trim(),
    subtitle: $("ev-subtitle").value.trim(),
    open: $("ev-open").checked
  }), "Uloženo.");
  document.activeElement?.blur?.();
});

/* =========================================================
   Nastavení – adresáti
   ========================================================= */
function renderTargets() {
  const list = sortedTargets(state.targets);
  const editing = document.activeElement?.closest?.("#targets-list");
  if (editing) return; // nepřepisovat během psaní
  $("targets-list").replaceChildren(
    el("li", { class: "target fixed" }, el("span", { class: "tname", text: "Všem (obecná otázka)" })),
    ...list.map((t, i) => el("li", { class: "target" },
      el("input", {
        class: "tname-in", value: t.name, maxlength: "80", "aria-label": "Jméno",
        onchange: (e) => {
          const v = e.target.value.trim();
          if (!v) { e.target.value = t.name; return; }
          run(update(ref(db, `config/targets/${t.id}`), { name: v }));
        }
      }),
      el("input", {
        class: "tnote-in", value: t.note, maxlength: "80", placeholder: "Popis (nepovinné)", "aria-label": "Popis",
        onchange: (e) => run(update(ref(db, `config/targets/${t.id}`), { note: e.target.value.trim() || null }))
      }),
      el("button", { class: "btn small icon", title: "Výš", "aria-label": "Posunout výš", disabled: i === 0, onclick: () => swapTargets(list, i, i - 1), text: "↑" }),
      el("button", { class: "btn small icon", title: "Níž", "aria-label": "Posunout níž", disabled: i === list.length - 1, onclick: () => swapTargets(list, i, i + 1), text: "↓" }),
      el("button", {
        class: "btn small ghost danger-text", text: "Smazat",
        onclick: () => {
          const n = Object.values(state.questions).filter((q) => q.target === t.id).length;
          const extra = n ? `\n\nPozor: ${n} otázek je adresováno tomuto jménu. Zůstanou zachované, ale zobrazí se jako „Neznámý adresát“.` : "";
          if (confirm(`Smazat „${t.name}“?${extra}`)) run(set(ref(db, `config/targets/${t.id}`), null));
        }
      })
    ))
  );
}

function swapTargets(list, i, j) {
  const a = list[i], b = list[j];
  const upd = {};
  list.forEach((t, k) => { upd[`config/targets/${t.id}/order`] = k + 1; });
  upd[`config/targets/${a.id}/order`] = j + 1;
  upd[`config/targets/${b.id}/order`] = i + 1;
  run(update(ref(db), upd));
}

function nextTargetOrder() {
  return Math.max(0, ...Object.values(state.targets).map((t) => t.order ?? 0)) + 1;
}

$("target-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("t-name").value.trim();
  const note = $("t-note").value.trim();
  if (!name) return;
  run(set(push(ref(db, "config/targets")), { name, note: note || null, order: nextTargetOrder() }), `Přidáno: ${name}`);
  $("t-name").value = "";
  $("t-note").value = "";
  $("t-name").focus();
});

$("import-guests").addEventListener("click", () => {
  const existing = new Set(Object.values(state.targets).map((t) => (t.name || "").toLowerCase()));
  const toAdd = POSTER_GUESTS.filter((n) => !existing.has(n.toLowerCase()));
  if (!toAdd.length) { toast("Všichni hosté z plakátu už v seznamu jsou."); return; }
  const upd = {};
  let order = nextTargetOrder();
  toAdd.forEach((name) => { upd[`config/targets/${push(ref(db, "config/targets")).key}`] = { name, order: order++ }; });
  run(update(ref(db), upd), `Přidáno ${toAdd.length} jmen.`);
});

/* =========================================================
   Nastavení – skryté otázky
   ========================================================= */
function renderHidden() {
  const items = Object.entries(state.hidden).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  $("hidden-count").textContent = items.length ? `(${items.length})` : "";
  $("hidden-empty").hidden = items.length > 0;
  $("hidden-list").replaceChildren(...items.map(([id, q]) => el("li", { class: "qi" },
    el("div", { class: "qi-meta" }, targetPill(q), el("span", { class: "muted", text: clockTime(q.createdAt) })),
    el("p", { class: "qi-text", text: q.text }),
    el("div", { class: "qi-actions" },
      el("button", { class: "btn small", onclick: () => restoreQuestion(id), text: "Vrátit" }),
      el("button", { class: "btn small ghost danger-text", onclick: () => deleteQuestion(id), text: "Smazat" })
    )
  )));
}

/* =========================================================
   Nastavení – odkaz, QR, export, smazání
   ========================================================= */
function renderLink() {
  const url = studentUrl();
  $("student-link").href = url;
  $("student-link").textContent = url;
  $("qr").innerHTML = qrSvg(url, 6, 2); // výstup knihovny, neobsahuje uživatelská data
  $("qr-download").href = qrDataUrl(url, 14, 4);
}
renderLink();

$("copy-link").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(studentUrl()); toast("Odkaz zkopírován."); }
  catch { toast("Kopírování se nepovedlo, označte odkaz ručně.", "error"); }
});

$("export-csv").addEventListener("click", () => {
  const qPos = Object.fromEntries(queueList().map((id, i) => [id, i + 1]));
  const rows = [["Čas", "Adresát", "Otázka", "Hlasy", "Položeno", "Pořadí ve frontě", "Skrytá"]];
  const add = (id, q, hidden) => rows.push([
    q.createdAt ? new Date(q.createdAt).toLocaleString("cs-CZ") : "",
    targetName(state.targets, q.target),
    q.text || "",
    voteCount(state.votes, id),
    q.asked ? "ano" : "ne",
    qPos[id] || "",
    hidden ? "ano" : "ne"
  ]);
  Object.entries(state.questions).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0)).forEach(([id, q]) => add(id, q, false));
  Object.entries(state.hidden).forEach(([id, q]) => add(id, q, true));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `otazky-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$("wipe-confirm").addEventListener("input", (e) => { $("wipe").disabled = e.target.value.trim() !== "SMAZAT"; });
$("wipe").addEventListener("click", () => {
  if ($("wipe-confirm").value.trim() !== "SMAZAT") return;
  run(update(ref(db), {
    questions: null, votes: null, authors: null, hidden: null, queue: null, lastPost: null,
    projection: { mode: "idle", current: null }
  }), "Všechny otázky a hlasy byly smazány.");
  $("wipe-confirm").value = "";
  $("wipe").disabled = true;
});

setInterval(renderAll, 30000);
