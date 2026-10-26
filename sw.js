/* Local-only app shell. PDFs, setlists and annotations live in IndexedDB.
 * A failed precache must never replace a working offline installation. */
const CACHE = 'liveset-v10-export-shell';
const ASSETS = ['index.html', 'manifest.json', 'rooms.js', 'qrcode.js',
  'pdf.min.js', 'pdf-lib.min.js', 'pdf.worker.min.js', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const urls = ASSETS.map(path => new URL(path, self.registration.scope).href);
const shell = urls[0];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is atomic: every required asset must have a successful response.
    await cache.addAll(urls.map(url => new Request(url, {cache:'reload'})));
    // Existing clients retain their version until closed, avoiding mixed code.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('liveset-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;
  // The synchronization server and its APIs must never be served from cache.
  if(['/info','/health','/sync','/qr.svg'].includes(url.pathname) || url.pathname.startsWith('/api/')) return;
  const isShellNavigation = req.mode === 'navigate' &&
    (url.pathname === new URL(shell).pathname || url.pathname === new URL(self.registration.scope).pathname);
  if(!isShellNavigation && !urls.includes(url.origin + url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(isShellNavigation ? shell : url.origin + url.pathname);
    return cached || fetch(req);
  })());
});
