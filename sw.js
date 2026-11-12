// Enkel service worker: gjør appen installerbar og laster appskallet raskt.
// Bilder og data hentes alltid fersk fra Supabase.
const CACHE = "komp-v5";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "fonts/figtree-400.woff2", "fonts/figtree-600.woff2", "fonts/figtree-700.woff2", "fonts/figtree-800.woff2"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Nettverk først, så appen alltid er oppdatert; cache bare som reserve uten nett.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// Push-varsler: vis varselet, og åpne KOMP når man trykker på det.
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "KOMP", {
    body: d.body || "Noen har delt noe nytt.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag,
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(wins => {
    for (const w of wins) if ("focus" in w) return w.focus();
    return self.clients.openWindow(url);
  }));
});
