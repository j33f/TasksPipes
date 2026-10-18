import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import RepeatSection from "./RepeatSection.svelte";
import type { Recurrence, TaskDetail } from "../lib/types";

const task = (over: Partial<TaskDetail> = {}) => ({
  id: "t1", dueDate: "2026-10-05", pipe: { id: "p", name: "Board", visibility: "private", kind: "general" },
  permissions: { view: true, manage: true, editContent: true, comment: true, refuse: false }, recurrence: null, ...over,
}) as TaskDetail;
const series: Recurrence = {
  id: "r", rule: { freq: "monthly", interval: 1, monthly: { kind: "weekday", nth: 1, weekday: 1 } }, mode: "schedule", leadDays: 3,
  startsOn: "2026-10-05", endsOn: null, nextOn: "2026-11-02", active: true, upcoming: ["2026-11-02", "2026-12-07"],
};

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(series), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("repeat section", () => {
  it("describes the series and its next dates", () => {
    render(RepeatSection, { task: task({ recurrence: series }), onchange: () => {} });
    expect(screen.getByText("On the first Monday of every month")).toBeTruthy();
    expect(screen.getByText(/^Next: /)).toBeTruthy();
  });

  it("sets a monthly repetition on the n-th weekday, made days ahead", async () => {
    const onchange = vi.fn();
    render(RepeatSection, { task: task(), onchange });
    await userEvent.click(screen.getByRole("button", { name: "Repeat…" }));
    await userEvent.selectOptions(screen.getByLabelText("Frequency"), "monthly");
    // Day of the month, n-th weekday, last business day: the second one.
    await userEvent.click(screen.getAllByRole("radio")[1]);
    await userEvent.clear(screen.getByLabelText("Days ahead"));
    await userEvent.type(screen.getByLabelText("Days ahead"), "7");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    // 5 October 2026 is the first Monday: the form started from it.
    expect(calls[0]).toMatchObject({ method: "PUT", url: "/api/tasks/t1/recurrence", body: {
      rule: { freq: "monthly", interval: 1, monthly: { kind: "weekday", nth: 1, weekday: 1 } }, mode: "schedule", leadDays: 7, endsOn: null,
    } });
    expect(onchange).toHaveBeenCalled();
  });

  it("is stopped, and only offered to those who manage the task", async () => {
    render(RepeatSection, { task: task({ recurrence: series }), onchange: () => {} });
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "/api/tasks/t1/recurrence" });
    cleanup();
    render(RepeatSection, { task: task({ permissions: { view: true, manage: false, editContent: false, comment: true, refuse: false } }), onchange: () => {} });
    expect(screen.queryByRole("button", { name: "Repeat…" })).toBeNull();
  });
});
