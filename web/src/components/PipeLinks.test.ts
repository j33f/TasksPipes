import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import PipeLinks from "./PipeLinks.svelte";
import { app } from "../lib/app.svelte";
import type { Me, PipeLink } from "../lib/types";

const me = (kind: "outline" | "email", outline = true): Me => ({
  user: { id: "u", name: "Gina", avatarUrl: null, email: "gina@example.com", kind, totp: false, locale: null, theme: null },
  personalSpaceId: "s",
  outlineUrl: "https://outline.test",
  features: { invitations: true, notifications: false, outline },
});
const brief: PipeLink = { id: "l1", source: "outline", url: "https://outline.test/doc/brief-abc", title: "Brief", outlineDocId: "d1" };
const mockups: PipeLink = { id: "l2", source: "figma", url: "https://www.figma.com/design/x", title: "Mock-ups", outlineDocId: null };
const pipe = (links: PipeLink[], canManage = true, kind = "dev") => ({ id: "p", kind, links, canManage });

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

describe("the documents of a pipe", () => {
  it("are listed; members remove them", async () => {
    app.me = me("outline");
    const onchange = vi.fn();
    render(PipeLinks, { pipe: pipe([brief, mockups]), onchange });
    expect(screen.getByRole("link", { name: "Mock-ups" }).getAttribute("href")).toBe(mockups.url);
    await userEvent.click(screen.getAllByTitle("Remove the link")[1]);
    expect(calls).toContainEqual({ method: "DELETE", url: "/api/pipes/p/links/l2", body: undefined });
    expect(onchange).toHaveBeenCalled();
  });

  it("are added from the sources of the pipe type, the address telling its source", async () => {
    app.me = me("outline");
    render(PipeLinks, { pipe: pipe([]), onchange: () => {} });
    await userEvent.click(screen.getByText("Link a document"));
    const sources = screen.getByRole("group", { name: "Where is the document?" });
    expect(sources.textContent).toContain("GitHub");
    await userEvent.click(screen.getByRole("button", { name: "GitHub" }));
    await userEvent.type(screen.getByLabelText("Address"), "https://github.com/acme/site");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(calls).toContainEqual({ method: "POST", url: "/api/pipes/p/links", body: { url: "https://github.com/acme/site", title: "" } });
  });

  it("from Outline are searched, or created in a collection", async () => {
    app.me = me("outline");
    render(PipeLinks, { pipe: pipe([], true, "general"), onchange: () => {} });
    await userEvent.click(screen.getByText("Link a document"));
    await userEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(screen.getByPlaceholderText("Search an Outline document or paste its URL…")).toBeTruthy();
    await userEvent.click(screen.getByText("Create in Outline"));
    await userEvent.click(await screen.findByRole("button", { name: "Create" }));
    expect(calls).toContainEqual({ method: "POST", url: "/api/pipes/p/outline-document", body: { collectionId: "c1" } });
  });

  it("cannot come from Outline for accounts without it, nor be changed by non-members", async () => {
    app.me = me("email");
    render(PipeLinks, { pipe: pipe([], true, "general"), onchange: () => {} });
    await userEvent.click(screen.getByText("Link a document"));
    expect(screen.queryByRole("button", { name: "Outline" })).toBeNull();
    cleanup();
    app.me = me("outline");
    render(PipeLinks, { pipe: pipe([mockups], false), onchange: () => {} });
    expect(screen.queryByText("Link a document")).toBeNull();
    expect(screen.queryByTitle("Remove the link")).toBeNull();
  });

  it("from Outline are hidden while Outline is turned off", () => {
    app.me = me("outline", false);
    render(PipeLinks, { pipe: pipe([brief, mockups], false), onchange: () => {} });
    expect(screen.queryByRole("link", { name: "Brief" })).toBeNull();
    expect(screen.getByRole("link", { name: "Mock-ups" })).toBeTruthy();
  });
});
