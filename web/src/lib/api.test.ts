import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";
import { prefs } from "./i18n.svelte";
import * as version from "./version.svelte";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  prefs.set({ locale: null });
});

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }));

describe("api", () => {
  it("sends the page's language and JSON bodies", async () => {
    prefs.set({ locale: "fr" });
    const fetch = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetch);
    expect(await api.post("/tasks", { title: "x" })).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Locale"]).toBe("fr");
    expect(init.body).toBe('{"title":"x"}');
  });

  it("checks the server version on every answer", async () => {
    const check = vi.spyOn(version, "checkServerVersion").mockImplementation(() => {});
    vi.stubGlobal("fetch", respond(200, {}, { "X-App-Version": "1.2.3" }));
    await api.get("/me");
    expect(check).toHaveBeenCalledWith("1.2.3");
  });

  it("turns errors into ApiError and signals a lost session", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "Not signed in" }));
    const lost = vi.fn();
    window.addEventListener("tp:unauthorized", lost);
    await expect(api.get("/me")).rejects.toEqual(new ApiError(401, "Not signed in"));
    expect(lost).toHaveBeenCalledOnce();
  });
});
