/* App-shell service worker.
 *
 * Model calls always need the network, but the shell, fonts, and the cached
 * hashed bundles do not: caching them means a reload on a flaky connection
 * still opens the app instead of a browser error. Strategy:
 *   - navigations: network-first, falling back to the cached shell
 *   - same-origin static GETs: stale-while-revalidate
 *   - /api/* is never cached (responses are personal, and a cached search or
 *     model call would be wrong)
 * Bump CACHE when the shell itself changes. */
const CACHE = 'byok-shell-v1'
const SHELL = ['/index.html', '/favicon.png', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? caches.match('/'))),
    )
    return
  }
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => hit)
      return hit ?? network
    }),
  )
})
