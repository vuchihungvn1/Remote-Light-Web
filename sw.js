const CACHE = 'remote-light-shell-v13';
const HOME = new URL('./index.html', self.registration.scope).href;
const ASSET_PATH = new URL('./assets/', self.registration.scope).pathname;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(HOME)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('remote-light-shell-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/v1/')) return;
  const navigation = event.request.mode === 'navigate';
  if (!navigation && !url.pathname.startsWith(ASSET_PATH)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (!navigation) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(event.request, navigation ? { cache: 'no-cache' } : undefined);
      if (response.ok && response.type === 'basic') {
        await cache.put(navigation ? HOME : event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return (navigation ? await cache.match(HOME) : undefined) ?? Response.error();
    }
  })());
});
