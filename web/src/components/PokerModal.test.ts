import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import PokerModal from "./PokerModal.svelte";
import { app } from "../lib/app.svelte";
import type { PipeDetail, PokerSession } from "../lib/types";

const task = (id: string, title: string, points: number | null) => ({ id, number: 1, title, points, taskType: "user_story", status: "ready" as const, estimated: null });
const session = (over: Partial<PokerSession> = {}): PokerSession => ({
  id: "s", status: "open", facilitatorId: "u1", tasks: [task("a", "Sign-in", null), task("b", "Profile", 3)], currentTaskId: "a", round: 1, revealed: false,
  participants: [
    { id: "u1", name: "Alice Martin", avatarUrl: null, present: true, voted: true, vote: "5" },
    { id: "u2", name: "Bob Durand", avatarUrl: null, present: true, voted: true, vote: null },
    { id: "u3", name: "Dave Petit", avatarUrl: null, present: true, voted: false, vote: null },
  ],
  stats: null, ...over,
});
const pipe = { id: "p", tasks: [{ id: "a", title: "Sign-in", status: "ready", points: null, position: 1, sprintId: null }, { id: "b", title: "Profile", status: "ready", points: 3, position: 2, sprintId: null }], sprints: [] } as unknown as PipeDetail;

let calls: { method: string; url: string; body: any }[];
let state: PokerSession | null;
beforeEach(() => {
  app.me = { user: { id: "u1", name: "Alice Martin" } } as never;
  calls = [];
  state = session();
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = url === "/api/pipes/p/poker" && (init?.method ?? "GET") === "GET" ? { enabled: true, session: state } : state;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Planning Poker", () => {
  it("shows who picked a card without showing it, one's own card, and lets the leader show them", async () => {
    render(PokerModal, { pipe, onclose: () => {} });
    const team = await screen.findByRole("list", { name: "The team" });
    // Alice and Bob picked a card, face down; Dave is still thinking.
    expect(within(team).getAllByLabelText("Card picked")).toHaveLength(2);
    expect(within(team).getByLabelText("Thinking")).toBeTruthy();
    expect(screen.getByRole("button", { name: "5", pressed: true })).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "8" }));
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/poker/s/vote", body: { value: "8" } });
    await fireEvent.click(screen.getByRole("button", { name: /Show the cards/ }));
    expect(calls.at(-1)).toMatchObject({ url: "/api/poker/s/reveal" });
  });

  it("once the cards are shown, suggests the points for the leader to set", async () => {
    state = session({ revealed: true, stats: { count: 2, min: 5, max: 8, median: 6.5, suggestion: 8, consensus: false },
      participants: session().participants.map((p) => (p.id === "u2" ? { ...p, vote: "8" } : p)) });
    render(PokerModal, { pipe, onclose: () => {} });
    expect(await screen.findByText("From 5 to 8")).toBeTruthy();
    expect((screen.getByLabelText("Points") as HTMLSelectElement).value).toBe("8");
    await fireEvent.click(screen.getByRole("button", { name: "Set the points" }));
    expect(calls.at(-1)).toMatchObject({ url: "/api/poker/s/estimate", body: { points: 8 } });
  });

  it("opens a session with the tasks without points chosen first", async () => {
    state = null;
    render(PokerModal, { pipe, onclose: () => {} });
    await fireEvent.click(await screen.findByRole("button", { name: /Open the session/ }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/pipes/p/poker", body: { taskIds: ["a"] } });
  });
});
