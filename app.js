// Guess the Footballer — logique du jeu
const MAX = 8;              // nombre d'essais
const POOL_DAILY = 200;     // le joueur du jour est tiré parmi les N plus cotés
const POOL_FREE = 400;      // idem pour la partie libre
const START = Date.UTC(2026, 0, 1);
const POS = { GB: "Gardien", DEF: "Défenseur", MIL: "Milieu", ATT: "Attaquant" };
const FOOT = { right: "Droit", left: "Gauche", both: "Deux pieds" };
const fmtFoot = f => FOOT[f] || "—";
const fmtHeight = h => (h ? (h / 100).toFixed(2).replace(".", ",") + " m" : "—");

const $ = id => document.getElementById(id);
const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

let P = [], byId = new Map(), poolDaily = [], poolFree = [];
let mode = "daily", target, guesses = [], over = false;

const dayNum = () => {
  const d = new Date();
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - START) / 864e5);
};

function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

async function init() {
  try {
    const res = await fetch("data/players.json", { cache: "no-cache" });
    const data = await res.json();
    P = data.players;
    P.forEach(p => { p.k = norm(p.n); byId.set(p.id, p); });
    const byValue = [...P].sort((a, b) => b.v - a.v);
    // tri par id pour que le joueur du jour soit stable même si les valeurs bougent un peu
    poolDaily = byValue.slice(0, POOL_DAILY).sort((a, b) => a.id - b.id);
    poolFree = byValue.slice(0, POOL_FREE);
    $("updated").textContent = `${P.length} joueurs des 5 grands championnats · données Transfermarkt du ${data.updated}.`;
    newGame();
  } catch (e) {
    $("sub").textContent = "Impossible de charger data/players.json. Lance le site via un serveur local (voir README).";
    console.error(e);
  }
}

function newGame() {
  guesses = []; over = false;
  if (mode === "daily") {
    const n = dayNum();
    target = poolDaily[((n * 7919) % poolDaily.length + poolDaily.length) % poolDaily.length];
    const saved = load("gtf-" + n);
    if (saved && saved.t === target.id) guesses = saved.g.map(id => byId.get(id)).filter(Boolean);
    $("slotNum").textContent = "Vignette n°" + (n + 1);
    $("sub").textContent = `Trouve le joueur du jour en ${MAX} essais.`;
  } else {
    target = poolFree[Math.floor(Math.random() * poolFree.length)];
    $("slotNum").textContent = "Partie libre";
    $("sub").textContent = "Un joueur au hasard, autant de parties que tu veux.";
  }
  $("slot").classList.remove("revealed");
  $("rows").innerHTML = "";
  $("result").classList.remove("show");
  guesses.forEach(g => addRow(g, false));
  checkEnd();
  updateCount();
  $("guess").disabled = over;
  $("guess").value = "";
}

function cmp(g) {
  const t = target;
  return {
    l: g.l === t.l ? "hit" : "",
    c: g.c === t.c ? "hit" : "",
    nat: g.nat === t.nat ? "hit" : (g.cont === t.cont && t.cont !== "?") ? "near" : "",
    pos: g.pos === t.pos ? "hit" : "",
    y: g.y === t.y ? "hit" : Math.abs(g.y - t.y) <= 2 ? "near" : "",
    arrow: g.y === t.y ? "" : (t.y > g.y ? " ↑" : " ↓"),
    // pied fort et taille : neutres si l'une des deux valeurs est inconnue
    foot: !g.foot || !t.foot ? "" : g.foot === t.foot ? "hit" : "",
    h: !g.h || !t.h ? "" : g.h === t.h ? "hit" : Math.abs(g.h - t.h) <= 3 ? "near" : "",
    harrow: !g.h || !t.h || g.h === t.h ? "" : (t.h > g.h ? " ↑" : " ↓"),
  };
}

function addRow(g, animate = true) {
  const r = cmp(g), tr = document.createElement("tr");
  if (animate) tr.className = "new";
  const cell = (txt, cls = "") => {
    const td = document.createElement("td");
    td.textContent = txt;
    if (cls) td.className = cls;
    return td;
  };
  tr.append(
    cell(g.n, g.id === target.id ? "name hit" : "name"),
    cell(g.l, r.l), cell(g.c, r.c), cell(g.nat, r.nat),
    cell(POS[g.pos], r.pos), cell(g.y + r.arrow, r.y),
    cell(fmtFoot(g.foot), r.foot), cell(fmtHeight(g.h) + r.harrow, r.h)
  );
  $("rows").prepend(tr);
}

function updateCount() {
  const dots = Array.from({ length: MAX }, (_, k) => `<i class="${k < guesses.length ? "used" : ""}"></i>`).join("");
  const n = Math.min(guesses.length + (over ? 0 : 1), MAX);
  $("count").innerHTML = `Essai ${n} sur ${MAX}<span class="dots" aria-hidden="true">${dots}</span>`;
}

function checkEnd() {
  const won = guesses.some(g => g.id === target.id);
  if (!won && guesses.length < MAX) return;
  over = true;
  $("guess").disabled = true;
  const t = target, back = $("back");
  back.innerHTML = "";
  const club = document.createElement("div"); club.style.cssText = "font-size:.8rem;font-weight:700"; club.textContent = t.c;
  const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = t.n;
  const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = `${t.nat} · ${POS[t.pos]} · ${t.y}`;
  if (t.h || t.foot) meta.append(document.createElement("br"), `${fmtHeight(t.h)} · pied ${fmtFoot(t.foot).toLowerCase()}`);
  back.append(club, nm, meta);
  $("slot").classList.add("revealed");
  $("resTitle").textContent = won ? "Vignette collée !" : "Raté pour cette fois";
  $("resText").textContent = won
    ? `Trouvé en ${guesses.length} essai${guesses.length > 1 ? "s" : ""}. C'était ${t.n}.`
    : `Le joueur mystère était ${t.n} (${t.c}).`;
  $("again").hidden = mode === "daily";
  $("result").classList.add("show");
}

function submit(p) {
  if (over || !p || guesses.some(g => g.id === p.id)) return;
  guesses.push(p);
  addRow(p);
  if (mode === "daily") save("gtf-" + dayNum(), { t: target.id, g: guesses.map(g => g.id) });
  checkEnd();
  updateCount();
  $("guess").value = "";
  closeList();
}

/* ---------- Autocomplétion ---------- */
let opts = [], sel = -1;

function openList(q) {
  const nq = norm(q.trim());
  const ul = $("list");
  if (nq.length < 2) { closeList(); return; }
  const used = new Set(guesses.map(g => g.id));
  opts = P.filter(p => !used.has(p.id) && p.k.includes(nq))
          .sort((a, b) => (b.k.startsWith(nq) - a.k.startsWith(nq)) || (b.v - a.v))
          .slice(0, 8);
  sel = opts.length ? 0 : -1;
  ul.innerHTML = "";
  if (!opts.length) {
    const li = document.createElement("li");
    li.className = "opt"; li.setAttribute("aria-disabled", "true");
    li.textContent = "Aucun joueur ne correspond. Essaie un autre nom.";
    ul.append(li);
  }
  opts.forEach((p, k) => {
    const li = document.createElement("li");
    li.className = "opt"; li.id = "o" + k; li.dataset.k = k;
    li.setAttribute("role", "option"); li.setAttribute("aria-selected", k === sel);
    li.textContent = p.n;
    const s = document.createElement("span"); s.textContent = p.c;
    li.append(s); ul.append(li);
  });
  ul.hidden = false;
  $("guess").setAttribute("aria-expanded", "true");
}

function closeList() {
  $("list").hidden = true; opts = []; sel = -1;
  $("guess").setAttribute("aria-expanded", "false");
}

function highlight() {
  [...$("list").children].forEach((li, k) => li.setAttribute("aria-selected", k === sel));
  $("guess").setAttribute("aria-activedescendant", sel >= 0 ? "o" + sel : "");
  const cur = $("o" + sel); if (cur) cur.scrollIntoView({ block: "nearest" });
}

$("guess").addEventListener("input", e => openList(e.target.value));
$("guess").addEventListener("keydown", e => {
  if (e.key === "ArrowDown" && opts.length) { sel = (sel + 1) % opts.length; highlight(); e.preventDefault(); }
  else if (e.key === "ArrowUp" && opts.length) { sel = (sel - 1 + opts.length) % opts.length; highlight(); e.preventDefault(); }
  else if (e.key === "Enter" && sel >= 0) { submit(opts[sel]); e.preventDefault(); }
  else if (e.key === "Escape") closeList();
});
$("list").addEventListener("mousedown", e => {
  const li = e.target.closest("[data-k]");
  if (li) { e.preventDefault(); submit(opts[+li.dataset.k]); }
});
$("guess").addEventListener("blur", () => setTimeout(closeList, 100));

/* ---------- Modes et partage ---------- */
function setMode(m) {
  mode = m;
  $("mDaily").setAttribute("aria-pressed", m === "daily");
  $("mFree").setAttribute("aria-pressed", m === "free");
  newGame();
}
$("mDaily").onclick = () => setMode("daily");
$("mFree").onclick = () => setMode("free");
$("again").onclick = () => newGame();

$("share").onclick = async () => {
  const e = { hit: "🟩", near: "🟧", "": "⬜" };
  const won = guesses.some(g => g.id === target.id);
  const lines = guesses.map(g => { const r = cmp(g); return [r.l, r.c, r.nat, r.pos, r.y, r.foot, r.h].map(x => e[x]).join(""); }).join("\n");
  const head = mode === "daily" ? `Guess the Footballer #${dayNum() + 1}` : "Guess the Footballer (libre)";
  const txt = `${head} ${won ? guesses.length : "X"}/${MAX}\n${lines}\n${location.href}`;
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch {}
  $("share").textContent = ok ? "Résultat copié" : "Copie impossible";
  setTimeout(() => ($("share").textContent = "Copier le résultat"), 1800);
};

init();