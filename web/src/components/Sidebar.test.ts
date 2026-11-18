import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import Sidebar from "./Sidebar.svelte";
import { app } from "../lib/app.svelte";

const PERSONAL = "space-personal";
let calls: { method: string; url: string }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url });
    return new Response(JSON.stringify({ mine: [], pinned: [], teams: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  // "My pipes" unfolded, so its pipe rows (and their menus) are shown.
  localStorage.setItem("tp:folds", JSON.stringify({ myPipes: true }));
  app.me = { user: { id: "u1", name: "Alice", email: "a@x.test", avatarUrl: null, kind: "outline", locale: null, theme: null }, personalSpaceId: PERSONAL, admin: false, features: { invitations: true, notifications: false, outline: true } } as unknown as typeof app.me;
  app.spaces = [{ id: PERSONAL, kind: "user", userId: "u1", name: "Alice", description: "", color: null, avatarUrl: null, active: true, guest: false, myRole: "admin", memberCount: 1, incomingCount: 0, pipeCount: 1 }] as never;
  app.sidebar = { mine: [{ id: "p1", spaceId: PERSONAL, name: "Projet démo", description: "", visibility: "private", kind: "general", icon: null, archived: false, isDefault: false, color: null, createdBy: null, counts: {}, dailyReport: false, weeklyReport: false, canManage: true } as never], pinned: [], teams: [] };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const openMenu = async (container: HTMLElement) => {
  await screen.findByText("Projet démo");
  const trigger = container.querySelector("[data-menu-trigger]") as HTMLElement;
  await fireEvent.click(trigger);
  return screen.getByRole("menu");
};

describe("sidebar pipe menu", () => {
  it("opens from the “…” trigger with its actions", async () => {
    const { container } = render(Sidebar, { open: true, onclose: () => {} });
    const menu = await openMenu(container);
    for (const label of ["New task", "Rename", "Pin", "Archive", "Delete"]) {
      expect(menu.textContent).toContain(label);
    }
  });

  it("Rename opens the inline editor (its handler reads the pipe, not a closed menu)", async () => {
    const { container } = render(Sidebar, { open: true, onclose: () => {} });
    const menu = await openMenu(container);
    await fireEvent.click(within(menu).getByText("Rename"));
    expect(container.querySelector("input.rename")).toBeTruthy();
  });

  it("Pin calls the API even though choosing it closes the menu", async () => {
    const { container } = render(Sidebar, { open: true, onclose: () => {} });
    const menu = await openMenu(container);
    await fireEvent.click(within(menu).getByText("Pin"));
    await vi.waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/api/pipes/p1/pin"))).toBe(true));
  });
});

describe("dropping a task on a pipe of the sidebar", () => {
  // After a drop the app reloads what it shares (catalog, spaces…): each URL its own answer.
  beforeEach(() => {
    // Earlier tests' refreshes leave the shared catalog as their generic answer had it.
    app.pipeTypes = [];
    app.taskTypes = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url });
      const answer = url.endsWith("/catalog") ? { pipeTypes: [], taskTypes: [] }
        : url.endsWith("/sidebar") ? { mine: app.sidebar.mine, pinned: [], teams: [] }
        : url.endsWith("/spaces") ? app.spaces
        : url.endsWith("/users") ? [] : { ok: true };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });
  const drop = (data: object | null) => {
    const store: Record<string, string> = data ? { "application/x-taskspipes-task": JSON.stringify(data) } : { "text/plain": "x" };
    return { types: Object.keys(store), getData: (k: string) => store[k] ?? "", dropEffect: "none" };
  };
  const target = async () => (await screen.findByText("Projet démo")).closest(".pipe-link") as HTMLElement;

  it("moves a task of the same space into the pipe", async () => {
    render(Sidebar, { open: true, onclose: () => {} });
    const el = await target();
    await fireEvent.dragOver(el, { dataTransfer: drop({ id: "t1", title: "Fix", pipeId: "other", spaceId: PERSONAL }) });
    expect(el.classList.contains("drop-target")).toBe(true);
    await fireEvent.drop(el, { dataTransfer: drop({ id: "t1", title: "Fix", pipeId: "other", spaceId: PERSONAL }) });
    expect(calls).toContainEqual({ method: "POST", url: "/api/tasks/t1/move" });
  });

  it("sends a task of another space to the pipe's space incoming, once confirmed", async () => {
    const asked = vi.fn(() => true);
    vi.stubGlobal("confirm", asked);
    render(Sidebar, { open: true, onclose: () => {} });
    await fireEvent.drop(await target(), { dataTransfer: drop({ id: "t2", title: "Quote", pipeId: "team-pipe", spaceId: "team-space" }) });
    expect(asked).toHaveBeenCalled();
    expect(calls).toContainEqual({ method: "POST", url: "/api/tasks/t2/send" });
  });

  it("does nothing with anything else dragged, or a task dropped on its own pipe", async () => {
    render(Sidebar, { open: true, onclose: () => {} });
    const el = await target();
    await fireEvent.dragOver(el, { dataTransfer: drop(null) });
    expect(el.classList.contains("drop-target")).toBe(false);
    await fireEvent.drop(el, { dataTransfer: drop({ id: "t3", title: "Same", pipeId: "p1", spaceId: PERSONAL }) });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });
});
