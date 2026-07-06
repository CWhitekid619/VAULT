/* VAULT Service Worker — R38-#4
   Strategie:
   - App-Shell (index.html): network-first, Cache nur als Offline-Fallback.
     Dadurch kommen neue R-Versionen sofort an, sobald man online ist —
     der Cache wird bei jedem erfolgreichen Online-Load mit aktualisiert.
   - TMDB-Bilder (image.tmdb.org): cache-first mit Mengen-Deckel — Poster
     ändern sich unter gleicher URL nie, das spart bei jedem App-Start Daten.
   - Alles andere (TMDB-API, Firebase/Firestore, Auth): wird NICHT angefasst.
   VERSION pro Release mitziehen (räumt alte Shell-Caches beim Aktivieren ab). */
const VERSION = "r43";
const SHELL_CACHE = "vault-shell-" + VERSION;
const IMG_CACHE = "vault-img-v1";
const IMG_LIMIT = 400;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(["./", "./index.html"]).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.indexOf("vault-shell-") === 0 && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, limit) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
  } catch (err) { /* Aufräumen darf nie eine Antwort blockieren */ }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  // TMDB-Bilder: cache-first (unveränderlich unter gleicher URL)
  if (url.hostname === "image.tmdb.org") {
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) {
        try { await cache.put(req, res.clone()); } catch (err) { /* Quota o.ä. — Bild trotzdem liefern */ }
        e.waitUntil(trimCache(IMG_CACHE, IMG_LIMIT));
      }
      return res;
    })());
    return;
  }

  // App-Shell: network-first, Cache als Offline-Fallback
  if (url.origin === self.location.origin &&
      (req.mode === "navigate" || url.pathname.slice(-11) === "/index.html")) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) { try { await cache.put(req, res.clone()); } catch (err) {} }
        return res;
      } catch (err) {
        return (await cache.match(req)) || (await cache.match("./index.html")) || Response.error();
      }
    })());
  }
  // alle übrigen Requests: Browser-Standardverhalten
});
