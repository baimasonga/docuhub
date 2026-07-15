// Minimal service worker: cache-first for immutable build assets, network-only
// for everything else (API responses and documents must never be cached).
const CACHE = 'avdp-dms-assets-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isBuildAsset = url.origin === self.location.origin && url.pathname.startsWith('/assets/');
  if (event.request.method !== 'GET' || !isBuildAsset) return; // fall through to network

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
  );
});
