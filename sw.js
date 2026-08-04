/*
 * Service worker: offline app shell + daily reminder wake-ups.
 *
 * Every path below is relative, so this works unchanged whether the app is
 * served from a domain root or from a GitHub Pages project subpath such as
 * https://username.github.io/5bx/. Relative URLs inside a service worker
 * resolve against the worker script's own URL, which is the app directory.
 *
 * BUMP CACHE_VERSION whenever you change any shell file, otherwise returning
 * visitors keep getting the old cached copy.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `5bx-shell-${CACHE_VERSION}`;

/* Cache used as a key/value store shared with the page (reminder settings). */
const KV_CACHE = '5bx-kv';
const KV_KEY = './reminder-settings.json';

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/app.js',
  './js/config.js',
  './js/state.js',
  './js/ui.js',
  './js/timer.js',
  './js/audio.js',
  './js/workout.js',
  './js/home.js',
  './js/history.js',
  './js/settings.js',
  './js/notifications.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

/* ---------------------------------------------------------------- install */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      // Only sweep old shell caches — the KV cache must survive upgrades.
      .filter((name) => name.startsWith('5bx-shell-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

/* ------------------------------------------------------------------ fetch */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: prefer the network so a deployed update is picked up
  // promptly, but fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Everything else: cache first (the shell is versioned), network as backup.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached ||
      fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
        }
        return response;
      })),
  );
});

/* -------------------------------------------------------------- reminders */

/*
 * Periodic Background Sync fires at an interval Chrome chooses (installed PWAs
 * only, and it is deliberately conservative). We treat each wake-up as "check
 * whether today's reminder is due", rather than assuming it lands on time.
 *
 * If the browser never wakes us — because the app is not installed, or Android
 * has restricted background work — the reminder falls back to the in-page
 * timer in js/notifications.js, which only runs while a tab is alive. There is
 * no way around this on the platform.
 */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === '5bx-daily-reminder') {
    event.waitUntil(maybeNotify());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === '5bx-daily-reminder') {
    event.waitUntil(maybeNotify());
  }
});

function localDateKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function readKV() {
  try {
    const cache = await caches.open(KV_CACHE);
    const res = await cache.match(KV_KEY, { ignoreSearch: true });
    return res ? res.json() : null;
  } catch {
    return null;
  }
}

async function writeKV(data) {
  const cache = await caches.open(KV_CACHE);
  await cache.put(KV_KEY, new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

async function maybeNotify() {
  const kv = await readKV();
  if (!kv?.enabled) return;

  const now = new Date();
  const today = localDateKey(now);
  if (kv.lastNotified === today) return;

  const [hours, minutes] = String(kv.time || '07:00').split(':').map(Number);
  const dueToday = new Date(now);
  dueToday.setHours(hours, minutes, 0, 0);
  if (now < dueToday) return; // not yet — a later wake-up will catch it

  await self.registration.showNotification('Time for your 5BX', {
    body: '11 minutes. Five exercises.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: '5bx-daily',
    renotify: false,
  });
  await writeKV({ ...kv, lastNotified: today });
}

/* Tapping the notification focuses an open tab, or opens the app. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const clientList = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true,
    });
    const existing = clientList.find((c) => c.url.startsWith(scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(scope);
  })());
});
