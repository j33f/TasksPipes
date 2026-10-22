import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import Calendar from "./Calendar.svelte";
import { app } from "../lib/app.svelte";
import { localDay } from "../lib/constants";
import { weekOf } from "../lib/calendar";

const [monday, tuesday, wednesday] = weekOf(localDay());
const task = (id: string, title: string, dueDate: string, canMove: boolean) => ({
  id, number: 1, title, dueDate, canMove, status: "ready", priority: null, labels: [],
  space: { id: "s", name: "Team", kind: "team" }, pipe: { id: "p", name: "Board", visibility: "private", kind: "general" },
});
const ghost = (id: string, title: string, dueDate: string, sourceId: string) => ({
  ...task(id, title, dueDate, false), number: 0, ghost: true, sourceId,
});

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  localStorage.setItem("tp:calendarView", "week");
  localStorage.setItem("tp:calendarScope", "mine");
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = String(url).startsWith("/api/calendar")
      ? {
          tasks: [task("t1", "Mine to move", monday, true), task("t2", "Someone else's", monday, false)],
          truncated: false,
          // A future occurrence of a recurring series, projected onto Tuesday.
          occurrences: [ghost("rec-r1-x", "Weekly sync", tuesday, "src1")],
        }
      : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("calendar", () => {
  it("asks the tasks of the week shown, and puts them on their day", async () => {
    render(Calendar);
    const item = await screen.findByText("Mine to move");
    const url = new URL(calls[0].url, "http://x");
    expect(url.pathname).toBe("/api/calendar");
    expect(url.searchParams.get("from")).toBe(monday);
    expect(url.searchParams.get("to")).toBe(weekOf(monday)[6]);
    expect(url.searchParams.get("scope")).toBe("mine");
    expect(item.closest("[data-day]")?.getAttribute("data-day")).toBe(monday);
    // Only tasks one may reschedule can be dragged.
    expect(item.closest("button")?.getAttribute("draggable")).toBe("true");
    expect(screen.getByText("Someone else's").closest("button")?.getAttribute("draggable")).toBe("false");
  });

  it("changes a due date by dropping the task on another day", async () => {
    const { container } = render(Calendar);
    const item = (await screen.findByText("Mine to move")).closest("button")!;
    await fireEvent.dragStart(item, { dataTransfer: { setData: () => {} } });
    const target = container.querySelector(`[data-day="${wednesday}"]`)!;
    await fireEvent.dragOver(target);
    await fireEvent.drop(target);
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/tasks/t1", body: { dueDate: wednesday } });
    expect(screen.getByText("Mine to move").closest("[data-day]")?.getAttribute("data-day")).toBe(wednesday);
  });

  it("shows everything one sees on demand", async () => {
    render(Calendar);
    await screen.findByText("Mine to move");
    await fireEvent.click(screen.getByRole("button", { name: "Everything I see" }));
    expect(new URL(calls.at(-1)!.url, "http://x").searchParams.get("scope")).toBe("all");
  });

  it("shows future recurring occurrences as non-draggable ghosts that open their source task", async () => {
    const spy = vi.spyOn(app, "openTask").mockImplementation(() => {});
    render(Calendar);
    const g = await screen.findByText("Weekly sync");
    const btn = g.closest("button")!;
    expect(btn.getAttribute("draggable")).toBe("false");
    expect(btn.closest("[data-day]")?.getAttribute("data-day")).toBe(tuesday);
    await fireEvent.click(btn);
    // A ghost is not a real task: clicking it opens the series' latest task, not a "rec-…" id.
    expect(spy).toHaveBeenCalledWith("src1");
    spy.mockRestore();
  });

  it("scopes to one pipe when embedded, without the scope filter", async () => {
    render(Calendar, { pipe: { id: "p9", name: "Board", spaceId: "s", kind: "general", canAddTasks: true } });
    await screen.findByText("Mine to move");
    const url = new URL(calls[0].url, "http://x");
    expect(url.searchParams.get("pipe")).toBe("p9");
    expect(url.searchParams.get("scope")).toBe("all");
    expect(screen.queryByRole("button", { name: "Everything I see" })).toBeNull();
  });

  it("opens a pre-dated new-task form when clicking an empty day", async () => {
    const { container } = render(Calendar, { pipe: { id: "p9", name: "Board", spaceId: "s", kind: "general", canAddTasks: true } });
    await screen.findByText("Mine to move");
    const cell = container.querySelector(`[data-day="${wednesday}"]`) as HTMLElement;
    await fireEvent.click(cell);
    expect(await screen.findByText(/New task/)).toBeTruthy();
  });
});
