// Service worker: offline app shell + Web Push (daily diaper alert, "next feeding" reminder) + notification clicks.
// Registered at start-up by js/push.js. Keep this file name: existing push
// subscriptions belong to this registration.
//
// Caching:
//  - install: precache the app shell (APP_SHELL).
//  - same-origin GET (not /api/): network first, so a new deploy shows up right away
//    when online; the cached copy is used when offline (or the network is very slow).
//  - Google Fonts: cache first.
//  - /api/ and other origins: never cached.
// Bump CACHE_VERSION when APP_SHELL changes; old caches are deleted on activate.

const CACHE_VERSION = "v4";
const CACHE = `baby-journal-${CACHE_VERSION}`;
const FONT_CACHE = "baby-journal-fonts-v1";
const OWN_CACHES = [CACHE, FONT_CACHE];
const NETWORK_TIMEOUT_MS = 4000;

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/styles.css",
  "/extra.css",
  "/css/today.css",
  "/css/stats.css",
  "/css/settings.css",
  "/js/core.js",
  "/js/push.js",
  "/js/today.js",
  "/js/history.js",
  "/js/stats.js",
  "/js/settings.js",
  "/js/sync.js",
  "/js/main.js",
  "/shared/rules.js",
  "/favicon.ico",
  "/icons/baby-journal-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One by one, so a single missing file can't break the install.
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: "reload" }));
        if (res.ok) await cache.put(url, res);
      } catch { /* offline during install: cached later at runtime */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith("baby-journal-") && !OWN_CACHES.includes(n))
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    event.respondWith(networkFirst(event, req, url));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(event, req, url) {
  const cache = await caches.open(CACHE);
  const isPage = req.mode === "navigate";
  // Pages are cached under "/" (the hash route is never sent to the server).
  const key = isPage ? "/" : url.pathname;
  const network = fetch(req).then((res) => {
    if (res.ok && res.type === "basic" && !url.search) {
      event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
    }
    return res;
  });
  const cached = () => cache.match(key).then((hit) => hit ||
    (isPage ? cache.match("/index.html") : undefined));
  // Slow network: fall back to the cache after a while (the fetch still updates it).
  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => cached().then((hit) => hit && resolve(hit)), NETWORK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([network, slow]);
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone()).catch(() => {});
  return res;
}

/* ---------------- Web Push ---------------- */

// Payload (from api/): {title, body, tag, url?, requireInteraction?, renotify?, vibrate?, timestamp?}.
// The feed reminder (tag "feed-alarm") asks for the strongest alert the web allows: it stays on
// screen until tapped (requireInteraction), vibrates, and alerts again even if an older one is shown.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }
  const tag = typeof data.tag === "string" && data.tag ? data.tag : undefined;
  const options = {
    body: data.body,
    tag,
    lang: "he",
    dir: "rtl",
    icon: "/icons/icon-192.png",
    data: { url: typeof data.url === "string" ? data.url : (tag && tag.startsWith("feed") ? "/#/" : "/#/stats") },
  };
  if (data.requireInteraction === true) options.requireInteraction = true;
  if (data.renotify === true && tag) options.renotify = true; // renotify without a tag throws
  if (Array.isArray(data.vibrate)) options.vibrate = data.vibrate.filter((n) => Number.isFinite(n)).slice(0, 20);
  if (Number.isFinite(data.timestamp)) options.timestamp = data.timestamp;
  event.waitUntil(self.registration.showNotification(data.title || "יומן תינוק", options)
    .catch(() => self.registration.showNotification(data.title || "יומן תינוק", { body: data.body, tag, data: options.data })));
});

/* ---------------- notification clicks (push and page notifications) ---------------- */

// Where a click should go: data.url when given, else by tag
// (feed alarm → journal, daily diaper reminder → stats).
function targetUrl(notification) {
  const data = notification.data || {};
  let path = typeof data.url === "string" ? data.url : null;
  if (!path) {
    const tag = notification.tag || "";
    path = tag.startsWith("diapers") ? "/#/stats" : "/#/";
  }
  const url = new URL(path, self.location.origin);
  return url.origin === self.location.origin ? url.href : new URL("/#/", self.location.origin).href;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = targetUrl(event.notification);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (!client) {
      await self.clients.openWindow(url);
      return;
    }
    try { await client.focus(); } catch { /* focus may be refused; still route below */ }
    // The page (js/push.js) routes itself without a reload. navigate() is the fallback;
    // it only works for clients this worker controls.
    try {
      client.postMessage({ type: "open-url", url });
    } catch {
      try { await client.navigate(url); } catch { /* uncontrolled client: leave it focused */ }
    }
  })());
});
