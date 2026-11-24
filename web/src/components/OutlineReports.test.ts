import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import OutlinePublish from "./OutlinePublish.svelte";
import OutlineAutoPublish from "./OutlineAutoPublish.svelte";
import { app } from "../lib/app.svelte";
import type { Me, OutlineExport } from "../lib/types";

const me = (kind: "outline" | "email"): Me => ({
  user: { id: "u", name: "Gina", avatarUrl: null, email: "gina@example.com", kind, totp: false, locale: null, theme: null },
  personalSpaceId: "s",
  outlineUrl: "https://outline.test",
  features: { invitations: true, notifications: false, outline: true },
});
const settings: OutlineExport = {
  parentDocId: "d1", parentDocTitle: "Daily reports", parentDocUrl: "https://outline.test/doc/daily-abc", outlineUser: "Bot",
  daily: true, weekly: false, weeklyParentDocId: null, weeklyParentDocTitle: null, weeklyParentDocUrl: null, sprints: false, setBy: "Gina", mine: true, keyRefused: false, lastError: null, lastErrorAt: null, lastExportAt: null, lastExportUrl: null,
};

let calls: { method: string; url: string; body: unknown }[];
let exportSettings: OutlineExport | null;
beforeEach(() => {
  calls = [];
  exportSettings = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    let answer: unknown = { ok: true };
    if (url.endsWith("/outline-export") && method === "GET") answer = exportSettings;
    else if (url.endsWith("/outline-export") && method === "PUT") answer = { ...settings, ...body };
    else if (url.startsWith("/api/outline/documents")) answer = [{ id: "d2", title: "Team notes", url: "https://outline.test/doc/notes-def" }];
    else if (url.endsWith("/outline")) answer = { id: "d9", title: "Activity of App", url: "https://outline.test/doc/new-9" };
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
});

describe("publishing a report to Outline by hand", () => {
  it("offers the pipe's parent document, then links to the new document", async () => {
    app.me = me("outline");
    exportSettings = settings;
    render(OutlinePublish, { pipeId: "p", path: "/pipes/p/reports/daily/outline", body: { date: "2026-11-24" } });
    await userEvent.click(screen.getByRole("button", { name: "Publish to Outline" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish under “Daily reports”" }));
    expect(calls).toContainEqual({ method: "POST", url: "/api/pipes/p/reports/daily/outline", body: { date: "2026-11-24", parentDocumentId: "d1" } });
    expect((await screen.findByRole("link", { name: "Activity of App" })).getAttribute("href")).toBe("https://outline.test/doc/new-9");
  });

  it("lets one pick any document as parent", async () => {
    app.me = me("outline");
    render(OutlinePublish, { pipeId: "p", path: "/sprints/s/report/outline" });
    await userEvent.click(screen.getByRole("button", { name: "Publish to Outline" }));
    await userEvent.click(await screen.findByPlaceholderText("Search an Outline document or paste its URL…"));
    await userEvent.click(await screen.findByRole("button", { name: "Team notes" }));
    expect(calls).toContainEqual({ method: "POST", url: "/api/sprints/s/report/outline", body: { parentDocumentId: "d2" } });
  });

  it("is not offered to accounts without Outline", () => {
    app.me = me("email");
    render(OutlinePublish, { pipeId: "p", path: "/pipes/p/reports/daily/outline" });
    expect(screen.queryByRole("button", { name: "Publish to Outline" })).toBeNull();
  });
});

describe("publishing a pipe's reports automatically", () => {
  it("is set up with a parent document and an API key", async () => {
    app.me = me("outline");
    render(OutlineAutoPublish, { pipe: { id: "p", kind: "dev" }, hour: 18 });
    await userEvent.click(await screen.findByRole("button", { name: "Publish the reports to Outline automatically…" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    await userEvent.click(screen.getByPlaceholderText("Search an Outline document or paste its URL…"));
    await userEvent.click(await screen.findByRole("button", { name: "Team notes" }));
    await userEvent.type(screen.getByPlaceholderText("ol_api_…"), " ol_api_secret ");
    await userEvent.click(save);
    expect(calls).toContainEqual({ method: "PUT", url: "/api/pipes/p/outline-export", body: { parentDocumentId: "d2", daily: true, sprints: false, apiKey: "ol_api_secret" } });
    expect(await screen.findByText(/as Bot/)).toBeTruthy();
  });

  it("sends the weekly time report under its own document, for pipes with time reports", async () => {
    app.me = me("outline");
    app.pipeTypes = [{ id: "dev", timeReport: true } as never];
    exportSettings = settings;
    render(OutlineAutoPublish, { pipe: { id: "p", kind: "dev" }, hour: 18 });
    await userEvent.click(await screen.findByRole("button", { name: "Change the key or the document" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Publish the weekly time report every Friday at 18:00" }));
    await userEvent.click(screen.getAllByPlaceholderText("Search an Outline document or paste its URL…").at(-1)!);
    await userEvent.click(await screen.findByRole("button", { name: "Team notes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls).toContainEqual({
      method: "PUT", url: "/api/pipes/p/outline-export",
      body: { parentDocumentId: "d1", daily: true, sprints: false, weekly: true, weeklyParentDocumentId: "d2" },
    });
    app.pipeTypes = [];
  });

  it("asks for one's own key to move someone else's to other documents", async () => {
    app.me = me("outline");
    app.pipeTypes = [{ id: "dev", timeReport: true } as never];
    exportSettings = { ...settings, setBy: "Hugo", mine: false };
    render(OutlineAutoPublish, { pipe: { id: "p", kind: "dev" }, hour: 18 });
    await userEvent.click(await screen.findByRole("button", { name: "Change the key or the document" }));
    const save = screen.getByRole("button", { name: "Save" });
    // Same documents: the key is kept.
    expect(save.hasAttribute("disabled")).toBe(false);
    await userEvent.click(screen.getByRole("checkbox", { name: "Publish the weekly time report every Friday at 18:00" }));
    await userEvent.click(screen.getAllByPlaceholderText("Search an Outline document or paste its URL…").at(-1)!);
    await userEvent.click(await screen.findByRole("button", { name: "Team notes" }));
    expect(screen.getByText("The current key is someone else's: give your own to publish under other documents.")).toBeTruthy();
    expect(save.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByPlaceholderText("ol_api_…"), "ol_api_mine");
    expect(save.hasAttribute("disabled")).toBe(false);
    app.pipeTypes = [];
  });

  it("shows a refused key, and stops", async () => {
    app.me = me("outline");
    exportSettings = { ...settings, keyRefused: true, lastError: "Authentication required" };
    render(OutlineAutoPublish, { pipe: { id: "p", kind: "dev" }, hour: 18 });
    expect(await screen.findByText("Outline refused the key: Authentication required. Give a new key to start again.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop publishing" }));
    expect(calls).toContainEqual({ method: "DELETE", url: "/api/pipes/p/outline-export", body: undefined });
    expect(await screen.findByRole("button", { name: "Publish the reports to Outline automatically…" })).toBeTruthy();
  });
});
