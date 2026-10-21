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
