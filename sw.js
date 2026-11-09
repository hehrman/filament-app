// Filament service worker: makes the app open instantly and work offline.
// Caches only the app's own files (versioned by ?v=); your data is never cached here.
const V = new URL(self.location).searchParams.get("v") || "dev";
const CACHE = `filament-${V}`;
const SHELL = ["./", "index.html", `styles.css?v=${V}`, `app.js?v=${V}`, `data.js?v=${V}`, `match.js?v=${V}`,
  `search.js?v=${V}`, `letterboxd.js?v=${V}`, "manifest.webmanifest", "icon.svg", "icon-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("filament-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;   // GitHub data, posters: straight to network
  if (req.mode === "navigate") {
    // the page itself: newest when online, cached when offline
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("index.html", copy)); return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
