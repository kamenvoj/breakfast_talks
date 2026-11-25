import {
  ref, onValue, push, update, set, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  db, ensureUser, el, timeAgo, eventWithDefaults, sortedTargets, targetName,
  voteCount, store, toast, GENERAL
} from "./common.js";
import { POST_COOLDOWN_MS, MAX_LEN } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);

const state = {
  uid: null,
  event: eventWithDefaults(null),
  targets: {},
  questions: {},
  votes: {},
  loaded: false,
  mine: new Set(store.get("bt_mine", [])),
  lastPost: store.get("bt_last_post", 0),
  filter: { target: "*", sort: "votes", hideAsked: false, mineOnly: false }
};

/* ---------- formulář ---------- */
const form = $("ask-form");
const textEl = $("ask-text");
const targetEl = $("ask-target");
const btn = $("ask-btn");

textEl.addEventListener("input", () => {
  const n = textEl.value.length;
  $("ask-count").textContent = n;
  $("ask-count").parentElement.classList.toggle("warn", n > MAX_LEN - 20);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textEl.value.trim().replace(/\s+\n/g, "\n");
  if (text.length < 3) { toast("Otázka je příliš krátká.", "error"); textEl.focus(); return; }
  if (text.length > MAX_LEN) { toast(`Otázka může mít nejvýše ${MAX_LEN} znaků.`, "error"); return; }
  const wait = state.lastPost + POST_COOLDOWN_MS - Date.now();
  if (wait > 0) { toast(`Další otázku můžete poslat za ${Math.ceil(wait / 1000)} s.`, "error"); return; }
  if (!state.uid) { toast("Připojuji se, zkuste to za okamžik.", "error"); return; }

  btn.disabled = true;
  const qid = push(ref(db, "questions")).key;
  try {
    await update(ref(db), {
      [`questions/${qid}`]: { text, target: targetEl.value || GENERAL, createdAt: serverTimestamp() },
      [`authors/${qid}`]: state.uid,
      [`lastPost/${state.uid}`]: serverTimestamp()
    });
    state.mine.add(qid);
    store.set("bt_mine", [...state.mine]);
    state.lastPost = Date.now();
    store.set("bt_last_post", state.lastPost);
    textEl.value = "";
    textEl.dispatchEvent(new Event("input"));
    toast("Otázka odeslána. Děkujeme!");
    render();
  } catch (err) {
    console.error(err);
    if (!state.event.open) toast("Příjem otázek je uzavřen.", "error");
    else toast("Odeslání se nepovedlo. Zkuste to prosím znovu za pár sekund.", "error");
  } finally {
    btn.disabled = !state.event.open;
  }
});

/* ---------- filtry ---------- */
$("f-target").addEventListener("change", (e) => { state.filter.target = e.target.value; render(); });
$("f-hide-asked").addEventListener("change", (e) => { state.filter.hideAsked = e.target.checked; render(); });
$("f-mine").addEventListener("change", (e) => { state.filter.mineOnly = e.target.checked; render(); });
document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
  state.filter.sort = b.dataset.sort;
  document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
  render();
}));

/* ---------- hlasování ---------- */
async function toggleVote(qid) {
  if (!state.uid || state.mine.has(qid)) return;
  const voted = !!state.votes?.[qid]?.[state.uid];
  try {
    await set(ref(db, `votes/${qid}/${state.uid}`), voted ? null : true);
  } catch (err) {
    console.error(err);
    toast("Hlas se nepodařilo uložit.", "error");
  }
}

/* ---------- vykreslení ---------- */
function fillTargetSelects() {
  const list = sortedTargets(state.targets);
  const keepAsk = targetEl.value;
  targetEl.replaceChildren(
    el("option", { value: GENERAL, text: "Všem (obecná otázka)" }),
    ...list.map((t) => el("option", { value: t.id, text: t.note ? `${t.name} – ${t.note}` : t.name }))
  );
  targetEl.value = [...targetEl.options].some((o) => o.value === keepAsk) ? keepAsk : GENERAL;

  const f = $("f-target");
  const keepF = state.filter.target;
  f.replaceChildren(
    el("option", { value: "*", text: "Všichni adresáti" }),
    el("option", { value: GENERAL, text: "Obecné (všem)" }),
    ...list.map((t) => el("option", { value: t.id, text: t.name }))
  );
  if ([...f.options].some((o) => o.value === keepF)) f.value = keepF;
  else { f.value = "*"; state.filter.target = "*"; }
}

function applyEvent() {
  const ev = state.event;
  $("ev-kicker").textContent = ev.kicker || "";
  $("ev-title").textContent = ev.title || "";
  $("ev-subtitle").textContent = ev.subtitle || "";
  document.title = `${ev.title || "Otázky"} – vaše otázky`;
  const open = ev.open !== false;
  btn.disabled = !open;
  textEl.disabled = !open;
  targetEl.disabled = !open;
  $("closed-msg").hidden = open;
}

function render() {
  if (!state.loaded) return;
  $("loading").hidden = true;
  const { target, sort, hideAsked, mineOnly } = state.filter;
  let items = Object.entries(state.questions).map(([id, q]) => ({ id, ...q, votes: voteCount(state.votes, id) }));
  const total = items.length;
  if (target !== "*") items = items.filter((q) => (q.target || GENERAL) === target);
  if (hideAsked) items = items.filter((q) => !q.asked);
  if (mineOnly) items = items.filter((q) => state.mine.has(q.id));
  items.sort(sort === "votes"
    ? (a, b) => b.votes - a.votes || (b.createdAt || 0) - (a.createdAt || 0)
    : (a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  $("list-count").textContent = total ? `(${items.length === total ? total : `${items.length} z ${total}`})` : "";
  $("empty").hidden = items.length > 0;
  $("empty").textContent = total ? "Žádná otázka neodpovídá filtru." : "Zatím tu nejsou žádné otázky. Buďte první!";

  $("list").replaceChildren(...items.map((q) => {
    const mine = state.mine.has(q.id);
    const voted = !!state.votes?.[q.id]?.[state.uid];
    const general = (q.target || GENERAL) === GENERAL;
    const voteBtn = el("button", {
      type: "button",
      class: `vote${voted ? " on" : ""}`,
      "aria-pressed": voted ? "true" : "false",
      "aria-label": mine ? `Vaše otázka, ${q.votes} hlasů` : `${voted ? "Zrušit hlas" : "Hlasovat"}, ${q.votes} hlasů`,
      title: mine ? "Pro vlastní otázku hlasovat nelze" : (q.asked ? "Otázka už byla položena" : ""),
      disabled: mine || q.asked,
      onclick: () => toggleVote(q.id)
    }, el("span", { class: "arrow", text: "▲" }), el("span", { text: q.votes }));

    return el("li", { class: `q${q.asked ? " asked" : ""}${mine ? " mine" : ""}` },
      el("div", { class: "q-meta" },
        el("span", { class: `q-target${general ? " general" : ""}`, text: general ? "Všem" : `Pro: ${targetName(state.targets, q.target)}` }),
        el("span", { text: timeAgo(q.createdAt) }),
        mine ? el("span", { class: "q-badge", text: "Vaše otázka" }) : null,
        q.asked ? el("span", { class: "q-asked", text: "✓ Položeno" }) : null
      ),
      el("p", { class: "q-text", text: q.text }),
      voteBtn
    );
  }));
}

/* ---------- start ---------- */
ensureUser().then((user) => {
  state.uid = user.uid;
  onValue(ref(db, "config/event"), (s) => { state.event = eventWithDefaults(s.val()); applyEvent(); });
  onValue(ref(db, "config/targets"), (s) => { state.targets = s.val() || {}; fillTargetSelects(); render(); });
  onValue(ref(db, "votes"), (s) => { state.votes = s.val() || {}; render(); });
  onValue(ref(db, "questions"), (s) => {
    state.questions = s.val() || {};
    state.loaded = true;
    render();
  }, (err) => {
    console.error(err);
    $("loading").textContent = "Nepodařilo se načíst otázky. Obnovte prosím stránku.";
  });
}).catch((err) => {
  console.error(err);
  $("loading").textContent = "Nepodařilo se připojit. Zkontrolujte připojení k internetu a obnovte stránku.";
});

setInterval(render, 30000);
