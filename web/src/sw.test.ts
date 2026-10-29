import source from "../public/sw.js?raw";
import { describe, expect, it, vi } from "vitest";

/** Runs public/sw.js against a fake worker scope, keeping its listeners. */
function load() {
  const listeners: Record<string, (e: any) => void> = {};
  const scope = {
    location: { href: "https://tasks.test/sw.js?v=1.2.3", origin: "https://tasks.test" },
    addEventListener: (type: string, fn: (e: any) => void) => (listeners[type] = fn),
    registration: { showNotification: vi.fn() },
    clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(), claim: vi.fn() },
    skipWaiting: vi.fn(),
  };
  new Function("self", source)(scope);
  return { listeners, scope };
}

const fetchEvent = (url: string, mode = "cors", method = "GET") => {
  const e = { request: { url, mode, method }, respondWith: vi.fn() };
  return e;
};

describe("service worker", () => {
  it("never answers data requests: they go to the network", () => {
    const { listeners } = load();
    for (const url of ["https://tasks.test/api/me", "https://tasks.test/api/tasks/1", "https://tasks.test/files/x", "https://tasks.test/api/avatars/u"]) {
      const e = fetchEvent(url);
      listeners.fetch(e);
      expect(e.respondWith, url).not.toHaveBeenCalled();
    }
    const post = fetchEvent("https://tasks.test/assets/app.js", "cors", "POST");
    listeners.fetch(post);
    expect(post.respondWith).not.toHaveBeenCalled();
    const other = fetchEvent("https://elsewhere.example/assets/app.js");
    listeners.fetch(other);
    expect(other.respondWith).not.toHaveBeenCalled();
  });

  it("leaves sign-in round trips to the browser", () => {
    const { listeners } = load();
    for (const url of ["https://tasks.test/auth/outline", "https://tasks.test/auth/outline/callback?code=c&state=s", "https://tasks.test/auth/oidc/callback"]) {
      const e = fetchEvent(url, "navigate");
      listeners.fetch(e);
      expect(e.respondWith, url).not.toHaveBeenCalled();
    }
  });

  it("keeps the interface: built files, fonts, icons, and the page for offline starts", async () => {
    vi.stubGlobal("caches", { match: vi.fn(async () => undefined), open: vi.fn(async () => ({ put: vi.fn() })) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("")));
    const { listeners } = load();
    for (const url of ["https://tasks.test/assets/index-abc.js", "https://tasks.test/fonts/x.woff2", "https://tasks.test/icons/icon-192.png"]) {
      const e = fetchEvent(url);
      listeners.fetch(e);
      expect(e.respondWith, url).toHaveBeenCalled();
      await e.respondWith.mock.calls[0][0];
    }
    const page = fetchEvent("https://tasks.test/pipes/p1", "navigate");
    listeners.fetch(page);
    expect(page.respondWith).toHaveBeenCalled();
    await page.respondWith.mock.calls[0][0];
    vi.unstubAllGlobals();
  });

  it("shows a pushed message, and opens its task on a click", async () => {
    const { listeners, scope } = load();
    const waits: Promise<unknown>[] = [];
    listeners.push({ data: { json: () => ({ title: "New task for you: TP-1", body: "Ann sent you this task", url: "https://tasks.test/?task=t1", tag: "task-t1" }) }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    expect(scope.registration.showNotification).toHaveBeenCalledWith("New task for you: TP-1", expect.objectContaining({ body: "Ann sent you this task", tag: "task-t1" }));
    listeners.notificationclick({ notification: { close: vi.fn(), data: { url: "https://tasks.test/?task=t1" } }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(scope.clients.openWindow).toHaveBeenCalledWith("https://tasks.test/?task=t1");
  });
});
