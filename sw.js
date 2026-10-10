// Service worker: caches the game so it starts instantly and works offline.
// Bump VERSION when the list of files changes.
const VERSION = 'emberwake-v4';
const CORE = [
  './', 'index.html', 'play.html', 'account.html', 'privacy.html', 'terms.html',
  'css/site.css', 'css/game.css', 'css/landing.css',
  'shared/sim.js', 'js/game/render.js', 'js/game/audio.js', 'js/game/input.js', 'js/game/net.js', 'js/game/main.js',
  'js/auth-config.js', 'js/auth.js', 'js/profile.js', 'js/pwa.js', 'js/site.js', 'js/hero.js', 'js/downloads.js',
  'assets/icons/logo.svg', 'assets/icons/favicon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'manifest.webmanifest', 'favicon.ico',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin files: network first so updates show up right away; fall back
// to the cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname === '/ws') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('play.html'))),
  );
});
