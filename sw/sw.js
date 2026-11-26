/* Duka Storefront service worker. The build fills in __PRECACHE__ and __VERSION__. */
const VERSION = '__VERSION__';
const CACHE = `duka-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new URL(u, self.registration.scope).toString())))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('duka-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const shellUrl = () => new URL('./', self.registration.scope).toString();

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: serve the cached shell straight away, refresh it in the background.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(shellUrl());
        const refresh = fetch(shellUrl())
          .then((res) => {
            if (res.ok) cache.put(shellUrl(), res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(refresh);
          return cached;
        }
        return (await refresh) || Response.error();
      }),
    );
    return;
  }

  // Everything else: cache first (assets are content-hashed), network as a fallback.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
