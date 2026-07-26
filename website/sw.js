/* ═══════════════════════════════════════════════════════════════
   NOVA UI · SERVICE WORKER
   Gives the site instant repeat loads and an offline experience.

   Strategy per resource type:
     • navigations  → network-first, fall back to cache, then to the
                      offline page. Users always get fresh content
                      when online but are never left with a browser
                      error when they are not.
     • css/js       → stale-while-revalidate. Paint immediately from
                      cache, update in the background for next time.
     • images/fonts → cache-first with a size-capped runtime cache.
     • APIs         → never cached here; the pages handle their own
                      short-lived caches with the right semantics.
   ═══════════════════════════════════════════════════════════════ */

const VERSION = 'v1';
const PRECACHE = `nova-precache-${VERSION}`;
const RUNTIME = `nova-runtime-${VERSION}`;
const IMAGES = `nova-images-${VERSION}`;

/* Kept deliberately small: the app shell only. Everything else is
   cached on demand, so a first visit is not slowed by a big prefetch. */
const PRECACHE_URLS = [
  '/app/',
  '/app/index.html',
  '/app/pack.html',
  '/app/guide.html',
  '/offline.html',
  '/gudang/web/css/dohan.config.css',
  '/gudang/web/css/gaya.css',
  '/gudang/web/css/releases.css',
  '/gudang/web/css/lainnya/warna.css',
  '/gudang/web/css/lainnya/responsif.css',
  '/gudang/web/css/sperpart/gerak.css',
  '/gudang/web/css/sperpart/aplikasi.css',
  '/gudang/web/js/dohan.config.js',
  '/gudang/web/js/gerak.js',
  '/gudang/web/js/aplikasi.js',
  '/gudang/web/js/app.js',
  '/gudang/web/js/jawa.js',
  '/gudang/web/js/webgl.js',
  '/gudang/icon_logo/nova_logo.png',
  '/gudang/icon_app/icon-192.png',
  '/manifest.webmanifest',
];

const IMAGE_CACHE_LIMIT = 60;

/* ── Install ─────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    // addAll rejects the whole batch if a single URL 404s, so each
    // entry is fetched independently and failures are tolerated.
    await Promise.allSettled(
      PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    self.skipWaiting();
  })());
});

/* ── Activate ────────────────────────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([PRECACHE, RUNTIME, IMAGES]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    // Navigation preload lets the browser start the network request
    // while the worker is still booting.
    await self.registration.navigationPreload?.enable();
    await self.clients.claim();
  })());
});

/* ── Helpers ─────────────────────────────────────────────────── */

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function networkFirst(event) {
  const cache = await caches.open(PRECACHE);
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || await fetch(event.request);
    if (response && response.ok) cache.put(event.request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(event.request) || await cache.match('/app/index.html');
    return cached || cache.match('/offline.html') || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || network || fetch(request);
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
      if (limit) trimCache(cacheName, limit);
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

/* ── Fetch ───────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live data must never be served stale by the worker.
  if (url.hostname === 'api.github.com' || url.hostname === 'docs.google.com') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event));
    return;
  }

  if (url.origin !== location.origin) {
    // Third-party fonts and icon sets: cache-first, they are versioned.
    if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.hostname)) {
      event.respondWith(cacheFirst(request, RUNTIME));
    }
    return;
  }

  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(staleWhileRevalidate(request, PRECACHE));
    return;
  }

  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(cacheFirst(request, IMAGES, IMAGE_CACHE_LIMIT));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME));
});

/* ── Messages ────────────────────────────────────────────────── */

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'clear-caches') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});
