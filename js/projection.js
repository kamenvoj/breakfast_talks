import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  db, ensureUser, el, eventWithDefaults, targetName, voteCount, studentUrl, qrSvg, GENERAL
} from "./common.js";

const $ = (id) => document.getElementById(id);
const QUEUE_MAX = 4;

const state = {
  event: eventWithDefaults(null),
  targets: {},
  questions: {},
  votes: {},
  queue: {},
  projection: { mode: "idle" }
};

/* QR kódy a adresa */
const url = studentUrl();
$("qr-big").innerHTML = qrSvg(url, 8, 1);   // výstup knihovny, bez uživatelských dat
$("qr-small").innerHTML = qrSvg(url, 6, 1);
$("url-big").textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/* Celá obrazovka a skrývání kurzoru */
function toggleFs() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}
$("fs-btn").addEventListener("click", toggleFs);
document.addEventListener("keydown", (e) => { if (e.key === "f" || e.key === "F") toggleFs(); });
let idleT;
function wake() {
  document.body.classList.remove("idle-mouse");
  clearTimeout(idleT);
  idleT = setTimeout(() => document.body.classList.add("idle-mouse"), 2500);
}
document.addEventListener("mousemove", wake);
wake();

/* Přizpůsobení velikosti písma otázky dostupnému místu */
function fitQuestion() {
  const wrap = document.querySelector(".q-text-wrap");
  const text = $("q-text");
  const u = $("stage").clientWidth / 100;
  let size = 4.6;
  text.style.fontSize = `${size * u}px`;
  while (size > 1.8 && text.scrollHeight > wrap.clientHeight + 1) {
    size -= 0.2;
    text.style.fontSize = `${size * u}px`;
  }
}
window.addEventListener("resize", () => { if (state.projection.mode === "question") fitQuestion(); });

function queueIds() {
  return Object.entries(state.queue)
    .filter(([id]) => state.questions[id])
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
    .map(([id]) => id);
}

function plural(n) {
  if (n === 1) return "hlas";
  if (n >= 2 && n <= 4) return "hlasy";
  return "hlasů";
}

function render() {
  const ev = state.event;
  $("ev-kicker").textContent = ev.kicker || "";
  $("ev-title").textContent = ev.title || "";
  $("ev-subtitle").textContent = ev.subtitle || "";

  let mode = state.projection?.mode || "idle";
  const q = state.questions[state.projection?.current];
  if (mode === "question" && !q) mode = "idle";

  $("s-idle").hidden = mode !== "idle";
  $("s-question").hidden = mode !== "question";
  $("s-queue").hidden = mode !== "queue";
  $("s-blank").hidden = mode !== "blank";
  $("corner-qr").hidden = !(mode === "question" || mode === "queue") || ev.open === false;
  $("stage").classList.toggle("is-blank", mode === "blank");
  $("stage").classList.toggle("is-content", mode === "question" || mode === "queue");

  if (mode === "question") {
    const general = (q.target || GENERAL) === GENERAL;
    $("q-target").textContent = general ? "všechny" : targetName(state.targets, q.target);
    $("q-text").textContent = q.text;
    const v = voteCount(state.votes, state.projection.current);
    $("q-votes").textContent = v ? `▲ ${v} ${plural(v)}` : "";
    requestAnimationFrame(fitQuestion);
  }

  if (mode === "queue") {
    const ids = queueIds().filter((id) => !state.questions[id].asked).slice(0, QUEUE_MAX);
    $("queue-empty").hidden = ids.length > 0;
    $("queue-list").replaceChildren(...ids.map((id, i) => {
      const item = state.questions[id];
      const general = (item.target || GENERAL) === GENERAL;
      return el("li", { class: i === 0 ? "first" : "" },
        el("span", { class: "n", text: String(i + 1).padStart(2, "0") }),
        el("div", {},
          el("div", { class: "t", text: general ? "Pro všechny" : `Pro: ${targetName(state.targets, item.target)}` }),
          el("div", { class: "x", text: item.text })
        )
      );
    }));
  }
}

ensureUser().then(() => {
  const watch = (path, key) => onValue(ref(db, path), (s) => {
    state[key] = key === "event" ? eventWithDefaults(s.val()) : (s.val() || (key === "projection" ? { mode: "idle" } : {}));
    render();
  }, (err) => { console.error(path, err); $("conn").hidden = false; $("conn").textContent = "Chyba připojení – obnovte stránku."; });
  watch("config/event", "event");
  watch("config/targets", "targets");
  watch("questions", "questions");
  watch("votes", "votes");
  watch("queue", "queue");
  watch("projection", "projection");

  onValue(ref(db, ".info/connected"), (s) => {
    $("conn").hidden = s.val() === true;
    if (!s.val()) $("conn").textContent = "Připojuji…";
  });
}).catch((err) => {
  console.error(err);
  $("conn").hidden = false;
  $("conn").textContent = "Nepodařilo se připojit.";
});

render();
