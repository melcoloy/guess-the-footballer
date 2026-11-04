// Guess the Footballer — logique du jeu
const MAX = 8;              // nombre d'essais
const HINT_AFTER = 5;       // initiales révélées après N essais ratés
const POOL_DAILY = 200;     // secours si data/daily.json manque : tirage parmi les N plus cotés
const START = Date.UTC(2026, 0, 1); // jour n°0 (doit rester égal à DAILY_START dans build_players.py)
const POS = { GB: "Gardien", DEF: "Défenseur", MIL: "Milieu", ATT: "Attaquant" };
const POS_LINE = { DEF: 0, MIL: 1, ATT: 2 };   // postes voisins = « proche » (le gardien n'a pas de voisin)
const LEAGUE_SHORT = { "Premier League": "PL", "Liga": "Liga", "Serie A": "Serie A", "Bundesliga": "Bund.", "Ligue 1": "L1" };
const FOOT = { right: "Droit", left: "Gauche", both: "Deux pieds" };
const STATE_TXT = { hit: "identique", near: "proche", "": "différent" };

const fmtFoot = f => FOOT[f] || "—";
const fmtHeight = h => (h ? (h / 100).toFixed(2).replace(".", ",") + " m" : "—");
const fmtValue = v => !v ? "—"
  : v >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: v < 1e7 ? 1 : 0 }) + " M€"
  : Math.round(v / 1e3) + " k€";
const fmtNat = p => (p.nat === "Inconnue" ? "—" : p.nat);
const fmtDate = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const initials = name => name.split(/[\s-]+/).filter(Boolean).map(w => w[0].toUpperCase() + ".").join(" ");

const $ = id => document.getElementById(id);
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

let P = [], byId = new Map(), byValue = [], calendar = null;
let mode = "daily", target, guesses = [], over = false, gameDay = 0;

const dayNum = () => {
  const d = new Date();
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - START) / 864e5);
};

function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

const settings = Object.assign({ theme: "auto", contrast: false }, load("gtf-settings"));
const freeOpts = Object.assign({ level: 400, league: "" }, load("gtf-free"));

/* ---------- Chargement ---------- */
async function init() {
  try {
    const [res, cal] = await Promise.all([
      fetch("data/players.json", { cache: "no-cache" }),
      fetch("data/daily.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const data = await res.json();
    P = data.players;
    calendar = cal;
    // joueur du jour parti des 5 championnats depuis : on le garde jouable grâce à sa fiche du calendrier
    if (cal && cal.players) for (const p of Object.values(cal.players)) if (!P.some(q => q.id === p.id)) P.push(p);
    P.forEach(p => { p.k = norm(p.n); byId.set(p.id, p); });
    byValue = [...P].sort((a, b) => b.v - a.v);
    const src = data.tm
      ? `effectifs Transfermarkt du ${fmtDate(data.tm)}${data.wikidata ? ", transferts suivants via Wikidata" : ""} · vérifié le ${fmtDate(data.updated)}`
      : `données Transfermarkt du ${fmtDate(data.updated)}`;
    $("updated").textContent = `${P.length} joueurs des 5 grands championnats · ${src}.`;
    backfillStats();
    newGame();
    if (!load("gtf-help")) { save("gtf-help", 1); openDialog("dHelp"); }
  } catch (e) {
    $("sub").textContent = "Impossible de charger data/players.json. Lance le site via un serveur local (voir README).";
    console.error(e);
  }
}

function dailyTarget(n) {
  const id = calendar && calendar.ids && calendar.ids[n];
  if (byId.has(id)) return byId.get(id);
  // calendrier absent ou épuisé : ancienne formule
  const pool = byValue.slice(0, POOL_DAILY).sort((a, b) => a.id - b.id);
  return pool[((n * 7919) % pool.length + pool.length) % pool.length];
}

function freePool() {
  let pool = byValue.filter(p => p.v > 0 && (!freeOpts.league || p.l === freeOpts.league));
  if (+freeOpts.level) pool = pool.slice(0, +freeOpts.level);
  return pool.length ? pool : byValue.slice(0, 400);
}

/* ---------- Partie ---------- */
function newGame() {
  const prev = target;
  guesses = []; over = false;
  if (mode === "daily") {
    gameDay = dayNum();
    target = dailyTarget(gameDay);
    const saved = load("gtf-" + gameDay);
    if (saved && saved.t === target.id) guesses = saved.g.map(id => byId.get(id)).filter(Boolean);
    $("slotNum").textContent = "Vignette n°" + (gameDay + 1);
    $("sub").textContent = `Trouve le joueur du jour en ${MAX} essais.`;
  } else {
    const pool = freePool();
    do target = pool[Math.floor(Math.random() * pool.length)];
    while (pool.length > 1 && target === prev);
    $("slotNum").textContent = "Partie libre";
    $("sub").textContent = "Un joueur au hasard, autant de parties que tu veux.";
  }
  $("slot").classList.remove("revealed");
  $("rows").innerHTML = "";
  $("grid").classList.toggle("has-rows", guesses.length > 0);
  $("result").classList.remove("show");
  guesses.forEach(g => addRow(g, false));
  checkEnd(false);
  updateCount();
  updateHint();
  $("guess").disabled = over;
  $("guess").value = "";
  closeList();
}

function cmp(g) {
  const t = target;
  const natKnown = g.cont !== "?" && t.cont !== "?";
  const pg = POS_LINE[g.pos], pt = POS_LINE[t.pos];
  return {
    l: g.l === t.l ? "hit" : "",
    c: g.c === t.c ? "hit" : "",
    nat: !natKnown ? "" : g.nat === t.nat ? "hit" : g.cont === t.cont ? "near" : "",
    pos: g.pos === t.pos ? "hit" : pg !== undefined && pt !== undefined && Math.abs(pg - pt) === 1 ? "near" : "",
    y: g.y === t.y ? "hit" : Math.abs(g.y - t.y) <= 2 ? "near" : "",
    arrow: g.y === t.y ? "" : (t.y > g.y ? " ↑" : " ↓"),
    // pied, taille et valeur : neutres si l'une des deux valeurs est inconnue
    foot: !g.foot || !t.foot ? "" : g.foot === t.foot ? "hit" : "",
    h: !g.h || !t.h ? "" : g.h === t.h ? "hit" : Math.abs(g.h - t.h) <= 3 ? "near" : "",
    harrow: !g.h || !t.h || g.h === t.h ? "" : (t.h > g.h ? " ↑" : " ↓"),
    v: !g.v || !t.v ? "" : g.v === t.v ? "hit" : Math.max(g.v, t.v) / Math.min(g.v, t.v) <= 1.25 ? "near" : "",
    varrow: !g.v || !t.v || g.v === t.v ? "" : (t.v > g.v ? " ↑" : " ↓"),
  };
}

function addRow(g, animate = true) {
  const r = cmp(g), row = document.createElement("div");
  row.className = animate ? "grow new" : "grow";
  row.setAttribute("role", "row");
  const cell = (label, full, cls = "", short = null, sr = true) => {
    const d = document.createElement("div");
    d.setAttribute("role", "cell");
    if (cls) d.className = cls;
    const lb = document.createElement("span"); lb.className = "lb"; lb.textContent = label;
    const v = document.createElement("span"); v.className = "v";
    if (short === null) v.textContent = full;
    else {
      const f = document.createElement("span"); f.className = "full"; f.textContent = full;
      const s = document.createElement("span"); s.className = "short"; s.textContent = short; s.setAttribute("aria-hidden", "true");
      v.append(f, s);
    }
    d.append(lb, v);
    if (sr) {
      const t = document.createElement("span"); t.className = "sr";
      t.textContent = ` (${STATE_TXT[cls.replace("name", "").trim()] || "différent"})`;
      d.append(t);
    }
    return d;
  };
  row.append(
    cell("Joueur", g.n, g.id === target.id ? "name hit" : "name", null, false),
    cell("Champ.", g.l, r.l, LEAGUE_SHORT[g.l] || g.l),
    cell("Club", g.c, r.c),
    cell("Nation", fmtNat(g), r.nat),
    cell("Poste", POS[g.pos], r.pos, g.pos),
    cell("Né en", g.y + r.arrow, r.y),
    cell("Pied", fmtFoot(g.foot), r.foot),
    cell("Taille", fmtHeight(g.h) + r.harrow, r.h),
    cell("Valeur", fmtValue(g.v) + r.varrow, r.v),
  );
  $("rows").prepend(row);
  $("grid").classList.add("has-rows");
}

function updateCount() {
  const dots = Array.from({ length: MAX }, (_, k) => `<i class="${k < guesses.length ? "used" : ""}"></i>`).join("");
  const n = Math.min(guesses.length + (over ? 0 : 1), MAX);
  $("count").innerHTML = `Essai ${n} sur ${MAX}<span class="dots" aria-hidden="true">${dots}</span>`;
}

function updateHint() {
  const show = !over && guesses.length >= HINT_AFTER;
  $("slotQ").textContent = show ? initials(target.n) : "?";
  $("slotQ").classList.toggle("initials", show);
  $("hint").hidden = !show;
  $("hint").textContent = "Indice : initiales";
}

function checkEnd(fresh) {
  const won = guesses.some(g => g.id === target.id);
  if (!won && guesses.length < MAX) return;
  over = true;
  $("guess").disabled = true;
  const t = target, back = $("back");
  back.innerHTML = "";
  const club = document.createElement("div"); club.className = "club"; club.textContent = t.c;
  const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = t.n;
  const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = `${fmtNat(t)} · ${POS[t.pos]} · ${t.y}`;
  if (t.h || t.foot) {
    const extra = document.createElement("span"); extra.className = "extra";
    extra.textContent = `${fmtHeight(t.h)} · pied ${fmtFoot(t.foot).toLowerCase()}`;
    meta.append(document.createElement("br"), extra);
  }
  back.append(club, nm, meta);
  $("slot").classList.add("revealed");
  $("resTitle").textContent = won ? "Vignette collée !" : "Raté pour cette fois";
  $("resText").textContent = won
    ? `Trouvé en ${guesses.length} essai${guesses.length > 1 ? "s" : ""}. C'était ${t.n}.`
    : `Le joueur mystère était ${t.n} (${t.c}).`;
  $("again").hidden = mode === "daily";
  $("toFree").hidden = mode !== "daily";
  $("next").hidden = mode !== "daily";
  $("result").classList.add("show");
  updateHint();
  tick();
  if (fresh) {
    recordGame(mode, won ? guesses.length : 0, gameDay);
    if (mode === "daily") setTimeout(() => openStats("daily"), 1400);
  }
}

function submit(p) {
  if (over || !p || guesses.some(g => g.id === p.id)) return;
  guesses.push(p);
  addRow(p);
  if (mode === "daily") save("gtf-" + gameDay, { t: target.id, g: guesses.map(g => g.id) });
  checkEnd(true);
  updateCount();
  updateHint();
  $("guess").value = "";
  closeList();
}

/* ---------- Statistiques (stockées dans le navigateur) ---------- */
const emptyStats = () => ({
  daily: { played: 0, wins: 0, streak: 0, best: 0, last: -1, lastWin: -1, dist: Array(MAX).fill(0) },
  free: { played: 0, wins: 0, dist: Array(MAX).fill(0) },
});
let lastResult = null; // { mode, n } pour surligner la barre de la dernière partie

// n = nombre d'essais si gagné, 0 si perdu
function recordGame(m, n, day, quiet = false) {
  const stats = load("gtf-stats") || emptyStats();
  const s = stats[m];
  if (m === "daily") {
    if (day <= s.last) return; // partie du jour déjà comptée
    s.last = day;
  }
  s.played++;
  if (n) {
    s.wins++; s.dist[n - 1]++;
    if (m === "daily") {
      s.streak = s.lastWin === day - 1 ? s.streak + 1 : 1;
      s.lastWin = day;
      s.best = Math.max(s.best, s.streak);
    }
  } else if (m === "daily") s.streak = 0;
  save("gtf-stats", stats);
  if (!quiet) lastResult = { mode: m, n };
}

// première visite depuis l'ajout des stats : on reconstitue l'historique des anciennes parties du jour
function backfillStats() {
  if (load("gtf-stats")) return;
  save("gtf-stats", emptyStats());
  const days = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const m = /^gtf-(\d+)$/.exec(localStorage.key(i));
      if (m) days.push(+m[1]);
    }
  } catch {}
  days.sort((a, b) => a - b).forEach(d => {
    const s = load("gtf-" + d);
    if (!s || !Array.isArray(s.g)) return;
    const k = s.g.indexOf(s.t);
    if (k >= 0) recordGame("daily", k + 1, d, true);
    else if (s.g.length >= MAX) recordGame("daily", 0, d, true);
  });
}

function dailyDone(day) {
  const s = load("gtf-" + day);
  return !!s && Array.isArray(s.g) && (s.g.includes(s.t) || s.g.length >= MAX);
}

let statsTab = "daily";
function openStats(tab) {
  statsTab = tab || mode;
  renderStats();
  openDialog("dStats");
}
function renderStats() {
  const stats = load("gtf-stats") || emptyStats(), s = stats[statsTab];
  $("stDaily").setAttribute("aria-pressed", statsTab === "daily");
  $("stFree").setAttribute("aria-pressed", statsTab === "free");
  const pct = s.played ? Math.round((100 * s.wins) / s.played) : 0;
  const kpi = (v, l) => `<div><b>${v}</b>${l}</div>`;
  if (statsTab === "daily") {
    const streak = s.lastWin >= dayNum() - 1 ? s.streak : 0; // un jour sauté casse la série
    $("kpis").innerHTML = kpi(s.played, "Parties") + kpi(pct, "% victoires") + kpi(streak, "Série en cours") + kpi(s.best, "Meilleure série");
  } else {
    const tries = s.dist.reduce((a, c, k) => a + c * (k + 1), 0);
    const avg = s.wins ? (tries / s.wins).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—";
    $("kpis").innerHTML = kpi(s.played, "Parties") + kpi(pct, "% victoires") + kpi(avg, "Essais en moyenne") + kpi(s.played - s.wins, "Ratées");
  }
  const top = Math.max(1, ...s.dist);
  $("dist").innerHTML = s.dist.map((c, k) => {
    const cur = lastResult && lastResult.mode === statsTab && lastResult.n === k + 1 ? " cur" : "";
    return `<div class="bar${cur}"><b>${k + 1}</b><span style="width:${Math.max(8, (100 * c) / top)}%">${c}</span></div>`;
  }).join("");
  $("statsNext").hidden = statsTab !== "daily" || !dailyDone(dayNum());
  tick();
}
$("stDaily").onclick = () => { statsTab = "daily"; renderStats(); };
$("stFree").onclick = () => { statsTab = "free"; renderStats(); };

/* ---------- Compte à rebours et changement de jour ---------- */
function tick() {
  const now = new Date();
  const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  const s = Math.floor(ms / 1000), pad = x => String(x).padStart(2, "0");
  const txt = `Prochain joueur dans <b>${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}</b>`;
  $("next").innerHTML = txt;
  $("statsNext").innerHTML = txt;
  if (mode === "daily" && P.length && dayNum() !== gameDay) newGame(); // minuit passé, page restée ouverte
}
setInterval(tick, 1000);

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

/* ---------- Modes, options et partage ---------- */
function setMode(m) {
  mode = m;
  $("mDaily").setAttribute("aria-pressed", m === "daily");
  $("mFree").setAttribute("aria-pressed", m === "free");
  $("freeOpts").hidden = m !== "free";
  newGame();
}
$("mDaily").onclick = () => setMode("daily");
$("mFree").onclick = () => setMode("free");
$("again").onclick = () => newGame();
$("toFree").onclick = () => { setMode("free"); $("guess").focus(); };
$("showStats").onclick = () => openStats(mode);

$("optLevel").value = String(freeOpts.level);
$("optLeague").value = freeOpts.league;
for (const id of ["optLevel", "optLeague"]) {
  $(id).onchange = () => {
    freeOpts.level = +$("optLevel").value;
    freeOpts.league = $("optLeague").value;
    save("gtf-free", freeOpts);
    if (mode === "free") newGame();
  };
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}

$("share").onclick = async () => {
  const e = settings.contrast ? { hit: "🟧", near: "🟦", "": "⬜" } : { hit: "🟩", near: "🟧", "": "⬜" };
  const won = guesses.some(g => g.id === target.id);
  const lines = guesses.map(g => { const r = cmp(g); return [r.l, r.c, r.nat, r.pos, r.y, r.foot, r.h, r.v].map(x => e[x]).join(""); }).join("\n");
  const level = { 100: "facile", 400: "moyen", 1000: "difficile", 0: "expert" }[freeOpts.level] || "";
  const head = mode === "daily"
    ? `Guess the Footballer #${gameDay + 1}`
    : `Guess the Footballer (libre, ${[level, freeOpts.league].filter(Boolean).join(", ")})`;
  const url = location.origin + location.pathname;
  const txt = `${head} ${won ? guesses.length : "X"}/${MAX}\n${lines}`;
  // téléphone : menu de partage natif (WhatsApp, SMS…) ; ordinateur : copie
  if (navigator.share && matchMedia("(pointer:coarse)").matches) {
    try { await navigator.share({ text: txt + "\n", url }); return; }
    catch (err) { if (err.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${txt}\n${url}`); toast("Résultat copié"); }
  catch { toast("Copie impossible"); }
};

/* ---------- Fenêtres : règles, statistiques, réglages ---------- */
function openDialog(id) {
  const d = $(id);
  if (d.open) return;
  document.querySelectorAll("dialog[open]").forEach(o => o.close());
  d.showModal();
}
document.querySelectorAll("dialog").forEach(d =>
  d.addEventListener("click", e => { if (e.target === d) d.close(); })); // clic sur le fond = fermer
$("bHelp").onclick = () => openDialog("dHelp");
$("legendHelp").onclick = () => openDialog("dHelp");
$("bStats").onclick = () => openStats(mode);
$("bSettings").onclick = () => openDialog("dSettings");

function applySettings() {
  const root = document.documentElement;
  if (settings.theme === "auto") delete root.dataset.theme; else root.dataset.theme = settings.theme;
  if (settings.contrast) root.dataset.contrast = "high"; else delete root.dataset.contrast;
  save("gtf-settings", settings);
}
document.querySelectorAll('input[name="theme"]').forEach(r => {
  r.checked = r.value === settings.theme;
  r.onchange = () => { settings.theme = r.value; applySettings(); };
});
$("setContrast").checked = settings.contrast;
$("setContrast").onchange = e => { settings.contrast = e.target.checked; applySettings(); };

/* ---------- Application installable / hors ligne ---------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
