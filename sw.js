// Bridge service worker: replaces the old app's offline copy (so the old address always
// forwards to filament-nyc.com) and keeps phone notifications from older setups working.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", () => { /* always the network: the forwarding page, never an old copy */ });
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || "Filament", {
    body: m.body || "Something you follow was scheduled.", icon: "icon-180.png", badge: "icon-180.png",
    data: { url: m.url || "https://filament-nyc.com/" }, tag: "filament",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "https://filament-nyc.com/";
  e.waitUntil(self.clients.openWindow(url.startsWith("https://filament-nyc.com") ? url : "https://filament-nyc.com/"));
});
