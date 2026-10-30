import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import PipeDoc from "./PipeDoc.svelte";
import { app } from "../lib/app.svelte";
import type { Me } from "../lib/types";

const me = (kind: "outline" | "email", outline = true): Me => ({
  user: { id: "u", name: "Gina", avatarUrl: null, email: "gina@example.com", kind, totp: false, locale: null, theme: null },
  personalSpaceId: "s",
  outlineUrl: "https://outline.test",
  features: { invitations: true, notifications: false, outline },
});
const doc = { id: "d1", title: "Brief", url: "https://outline.test/doc/brief-abc" };

let calls: { method: string; url: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = url === "/api/outline/collections" ? [{ id: "c1", name: "Projects" }] : { ok: true };
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
});

describe("the Outline document of a pipe", () => {
  it("links to the document; its members can unlink it", async () => {
    app.me = me("outline");
    const onchange = vi.fn();
    render(PipeDoc, { pipe: { id: "p", outlineDoc: doc, canManage: true }, onchange });
    expect(screen.getByRole("link", { name: "Brief" }).getAttribute("href")).toBe(doc.url);
    await userEvent.click(screen.getByTitle("Unlink"));
    expect(calls).toContainEqual({ method: "PATCH", url: "/api/pipes/p", body: { outlineDoc: null } });
    expect(onchange).toHaveBeenCalled();
  });

  it("is created in a collection chosen by a member", async () => {
    app.me = me("outline");
    render(PipeDoc, { pipe: { id: "p", outlineDoc: null, canManage: true }, onchange: () => {} });
    await userEvent.click(screen.getByText("Create in Outline"));
    await userEvent.click(await screen.findByRole("button", { name: "Create" }));
    expect(calls).toContainEqual({ method: "POST", url: "/api/pipes/p/outline-document", body: { collectionId: "c1" } });
  });

  it("offers nothing to people who cannot link one", () => {
    app.me = me("outline");
    render(PipeDoc, { pipe: { id: "p", outlineDoc: null, canManage: false }, onchange: () => {} });
    expect(screen.queryByText("Link a document")).toBeNull();
    cleanup();
    app.me = me("email");
    render(PipeDoc, { pipe: { id: "p", outlineDoc: null, canManage: true }, onchange: () => {} });
    expect(screen.queryByText("Link a document")).toBeNull();
  });

  it("is hidden when Outline is turned off", () => {
    app.me = me("outline", false);
    render(PipeDoc, { pipe: { id: "p", outlineDoc: doc, canManage: true }, onchange: () => {} });
    expect(screen.queryByRole("link", { name: "Brief" })).toBeNull();
  });
});
