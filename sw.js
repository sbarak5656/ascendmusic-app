/* Offline cache for the Ascend Music web app. Bump VERSION when the file list changes. */
const VERSION = "ascendmusic-v1";
const FILES = [
  "./", "./index.html", "./app.css", "./app.js", "./ui-version.js", "./program.js", "./config.js", "./manifest.webmanifest",
  "./fonts.css", "./fonts/bodoni-moda-normal-500.woff2", "./fonts/bodoni-moda-italic-500.woff2",
  "./fonts/libre-franklin-normal-400.woff2", "./fonts/ibm-plex-mono-normal-400.woff2",
  "./fonts/ibm-plex-mono-normal-500.woff2", "./fonts/ibm-plex-mono-normal-600.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-64.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* network-first so updates show up, cache fallback so it works offline */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(m => m || caches.match("./index.html")))
  );
});
