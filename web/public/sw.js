// TasksPipes service worker: keeps the interface for quick starts and shows push notifications.
// Only the interface is cached (the page, its scripts, styles, fonts and icons), never data: /api, files and
// avatars always go to the network, so nothing of one person can be served to another.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `tasks-pipes-ui-${VERSION}`;
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(SHELL, { cache: "reload" }))).then(() => self.skipWaiting()));
});

// Interfaces of older versions go.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tasks-pipes-ui-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Static files of the interface: built assets (their name changes with their content), fonts, icons. */
const isAsset = (url) => /^\/(assets|fonts|icons)\//.test(url.pathname) || url.pathname === "/favicon.svg" || url.pathname === "/manifest.webmanifest";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Sign-in round trips (to the provider and back) are left to the browser: some browsers drop the sign-in cookie
  // from a navigation coming back from another site when a service worker answers it.
  if (url.pathname.startsWith("/auth/")) return;
  if (req.mode === "navigate") {
    // The page from the network, the kept one when offline.
    event.respondWith(fetch(req).catch(() => caches.match(SHELL)));
    return;
  }
  if (!isAsset(url)) return;
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});

self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = { title: "TasksPipes", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(m.title || "TasksPipes", {
    body: m.body || "", tag: m.tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: m.url || "/" },
  }));
});

// A click opens the task: in a tab of the app already open if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === url.origin);
      if (open) return open.focus().then((c) => c.navigate(url.href));
      return self.clients.openWindow(url.href);
    })
  );
});
