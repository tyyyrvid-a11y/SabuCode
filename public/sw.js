// App-shell cache so the UI (not live data) loads instantly and offline.
// Everything under /api/ always goes to the network -- chat, search, export and
// auth/session data must never be served stale.
const CACHE = 'sabucode-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/css/style.css',
  '/js/icons.js',
  '/js/auth.js',
  '/js/store.js',
  '/js/haptics.js',
  '/js/sound.js',
  '/js/preview.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // deliberately no self.clients.claim() here -- claiming already-open tabs
  // mid-session can abort an in-flight fetch (e.g. the streaming /api/chat
  // request) out from under the page. The new worker takes over on next load.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // network-first for the shell so deploys show up without waiting on cache
  // expiry, falling back to cache when offline
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});
