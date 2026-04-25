import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Activate this SW as soon as it installs and immediately take control of all
// open tabs, instead of waiting for every tab to close. Without these, deploys
// leave users running the previous bundle (which references hashed asset names
// that no longer exist on the server) until they manually close every tab —
// producing blank/refresh-loop pages after each release.
self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Cache API calls with NetworkFirst (serve cached when offline, max 5 min stale).
// Auth endpoints are excluded — caching a 401 or stale /me response would make
// post-login states look broken until the cache entry expires.
registerRoute(
  ({ url }) =>
    url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/api/auth/') &&
    !url.pathname.startsWith('/api/me'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 300 })
    ]
  })
);
