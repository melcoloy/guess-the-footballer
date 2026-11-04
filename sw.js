// Service worker : rend le site installable et jouable hors ligne.
// Pages et données : réseau d'abord (toujours à jour), cache si hors ligne.
// Polices, icônes, CSS, JS : cache d'abord, mis à jour en arrière-plan.
// Change VERSION pour forcer le renouvellement complet du cache.
const VERSION = "gtf-v1";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "data/players.json", "data/daily.json",
  "icons/icon.svg", "icons/icon-192.png",
  "fonts/anton-latin-400-normal.woff2",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2",
  "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-latin-700-normal.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  const networkFirst = req.mode === "navigate" || url.pathname.endsWith(".json");
  if (networkFirst) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
