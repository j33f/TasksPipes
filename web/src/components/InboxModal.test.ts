import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import InboxModal from "./InboxModal.svelte";
import { app } from "../lib/app.svelte";
import { inbox } from "../lib/inbox.svelte";
import { router } from "../lib/router.svelte";
import type { InboxItem } from "../lib/types";

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 1, kind: "created", createdAt: new Date().toISOString(),
  actor: { id: "u-bob", name: "Bob", avatarUrl: null }, excerpt: null,
  task: { id: "t1", number: 7, title: "Book the room", pipe: { id: "p1", name: "Board" }, space: { id: "sp", name: "Trainers", kind: "team" } },
  ...over,
});

let calls: { url: string; body: unknown }[];
let items: InboxItem[];
beforeEach(() => {
  calls = [];
  items = [item(), item({ id: 2, kind: "comment", excerpt: "Looks good", task: { ...item().task, id: "t2", number: 8, title: "Print the badges" } })];
  inbox.reset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url === "/api/inbox/read") {
      const ids = (body as { ids?: number[] }).ids;
      items = ids ? items.filter((i) => !ids.includes(i.id)) : [];
      return new Response(JSON.stringify({ unread: items.length }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ items, unread: items.length }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
  router.sync();
  app.highlight = null;
});

describe("notifications dialog", () => {
  it("lists what happened, with the task and where it is", async () => {
    render(InboxModal, { onclose: () => {} });
    expect(await screen.findByText("Bob added a task to Board")).toBeTruthy();
    expect(screen.getByText("#7 Book the room")).toBeTruthy();
    expect(screen.getByText("Bob commented on a task")).toBeTruthy();
    expect(screen.getByText("“Looks good”")).toBeTruthy();
    expect(screen.getAllByText(/Trainers › Board/)).toHaveLength(2);
    expect(screen.getByText("2 unread notifications")).toBeTruthy();
  });

  it("marks one as read with its icon, or all of them", async () => {
    render(InboxModal, { onclose: () => {} });
    await screen.findByText("#7 Book the room");
    await userEvent.click(screen.getAllByRole("button", { name: "Mark as read" })[0]);
    await waitFor(() => expect(screen.queryByText("#7 Book the room")).toBeNull());
    expect(calls.at(-1)).toEqual({ url: "/api/inbox/read", body: { ids: [1] } });
    await userEvent.click(screen.getByRole("button", { name: /Mark all as read/ }));
    expect(await screen.findByText("You are all caught up.")).toBeTruthy();
    expect(calls.at(-1)).toEqual({ url: "/api/inbox/read", body: {} });
    expect(inbox.unread).toBe(0);
  });

  it("goes to the task's pipe to show it in yellow, and marks it as read", async () => {
    const onclose = vi.fn();
    render(InboxModal, { onclose });
    await userEvent.click(await screen.findByText("#7 Book the room"));
    expect(onclose).toHaveBeenCalled();
    expect(router.path).toBe("/pipes/p1");
    expect(app.highlight).toBe("t1");
    expect(calls.some((c) => c.url === "/api/inbox/read" && JSON.stringify(c.body) === '{"ids":[1]}')).toBe(true);
  });

  it("goes to the incoming for a task not in a pipe", async () => {
    items = [item({ kind: "received", task: { ...item().task, pipe: null } })];
    render(InboxModal, { onclose: () => {} });
    expect(await screen.findByText("Bob sent a task to Trainers")).toBeTruthy();
    await userEvent.click(screen.getByText("#7 Book the room"));
    expect(router.path + router.search).toBe("/spaces/sp?tab=incoming");
  });

  it("marks one as read when swiped aside on a touch screen", async () => {
    render(InboxModal, { onclose: () => {} });
    const row = (await screen.findByText("#7 Book the room")).closest("li")!;
    Object.defineProperty(row, "offsetWidth", { value: 300 });
    await fireEvent.pointerDown(row, { pointerType: "touch", clientX: 50, clientY: 10 });
    await fireEvent.pointerMove(row, { pointerType: "touch", clientX: 120, clientY: 12 });
    await fireEvent.pointerMove(row, { pointerType: "touch", clientX: 200, clientY: 12 });
    await fireEvent.pointerUp(row, { pointerType: "touch", clientX: 200, clientY: 12 });
    await waitFor(() => expect(screen.queryByText("#7 Book the room")).toBeNull());
    expect(calls.at(-1)).toEqual({ url: "/api/inbox/read", body: { ids: [1] } });
    expect(router.path).toBe("/"); // a swipe does not open the task
  });
});
