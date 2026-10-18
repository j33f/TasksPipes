import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import TimeSection from "./TimeSection.svelte";
import type { TaskDetail } from "../lib/types";

const can = { view: true, manage: true, editContent: true, comment: true, refuse: false };
const task = (over: Partial<TaskDetail> = {}) => ({ id: "t1", estimateMinutes: 120, loggedMinutes: 150, permissions: can, ...over }) as TaskDetail;
const entries = [
  { id: "e1", user: { id: "u1", name: "Ann", avatarUrl: null }, spentOn: "2026-10-16", minutes: 90, note: "Specs", createdAt: "", mine: true, canDelete: true },
  { id: "e2", user: { id: "u2", name: "Bob", avatarUrl: null }, spentOn: "2026-10-15", minutes: 60, note: "", createdAt: "", mine: false, canDelete: false },
];

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = (init?.method ?? "GET") === "GET" ? { entries, totalMinutes: 150 } : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("time section", () => {
  it("shows the logged time against the estimate, red once over", async () => {
    render(TimeSection, { task: task(), onchange: () => {} });
    expect(await screen.findByText("2 h 30 / 2 h")).toBeTruthy();
    expect(screen.getByText("Over the estimate")).toBeTruthy();
    expect(screen.getByText("Specs")).toBeTruthy();
    // One's own entry can be changed and deleted, someone else's not.
    expect(screen.getAllByTitle("Change")).toHaveLength(1);
    expect(screen.getAllByTitle("Delete")).toHaveLength(1);
  });

  it("logs time typed as a duration, and refuses what is not one", async () => {
    render(TimeSection, { task: task(), onchange: () => {} });
    await userEvent.type(screen.getByLabelText("Time spent"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Log time" }));
    expect(screen.getByText("Write a duration like 2h30, 1.5 or 45min")).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Time spent"));
    await userEvent.type(screen.getByLabelText("Time spent"), "1h30");
    await userEvent.type(screen.getByLabelText("Note (optional)"), "Review");
    await userEvent.click(screen.getByRole("button", { name: "Log time" }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/tasks/t1/time", body: { minutes: 90, note: "Review" } });
  });

  it("saves the estimate", async () => {
    render(TimeSection, { task: task({ estimateMinutes: null }), onchange: () => {} });
    await userEvent.type(screen.getByLabelText("Estimate"), "1.5{Enter}");
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/tasks/t1", body: { estimateMinutes: 90 } });
  });

  it("is read-only for those who cannot edit the task", async () => {
    render(TimeSection, { task: task({ permissions: { ...can, editContent: false } }), onchange: () => {} });
    await screen.findByText("Specs");
    expect(screen.queryByRole("button", { name: "Log time" })).toBeNull();
    expect(screen.queryByLabelText("Estimate")).toBeNull();
  });
});
