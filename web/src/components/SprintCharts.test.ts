import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import BurndownChart from "./BurndownChart.svelte";
import ProgressChart from "./ProgressChart.svelte";

// The charts follow their width (bind:clientWidth), which jsdom does not measure.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sprint charts", () => {
  it("draw a burndown with its legend, its last figure and its table, and a tooltip on hover", async () => {
    const points = [
      { day: null, ideal: 10, remaining: 10, scope: 10 },
      { day: "2026-11-30", ideal: 5, remaining: 8, scope: 12 },
      { day: "2026-12-01", ideal: 0, remaining: null, scope: null },
    ];
    const { container } = render(BurndownChart, { points });
    expect(screen.getByRole("img", { name: /Burndown/ })).toBeTruthy();
    for (const name of ["Remaining", "Ideal", "Scope"]) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    // The last day measured is labelled; the day to come shows no figure.
    expect(screen.getByText("8 pts")).toBeTruthy();
    const rows = within(container.querySelector("table")!).getAllByRole("row");
    const cells = rows.map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent?.trim()));
    expect(cells.map((c) => c.slice(1))).toEqual([["Remaining", "Ideal", "Scope"], ["10", "10", "10"], ["8", "5", "12"], ["–", "0", "–"]]);
    await fireEvent.mouseEnter(container.querySelectorAll("rect.hit")[2]);
    expect(container.querySelector(".tooltip")?.textContent).toContain("To come");
  });

  it("draw the pipe's progress as done and still to do, per sprint", async () => {
    const rows = [
      { sprintId: null, name: null, endsOn: "2026-11-30", done: 0, remaining: 40 },
      { sprintId: "s1", name: "Sprint 1", endsOn: "2026-12-13", done: 18, remaining: 30 },
    ];
    const { container } = render(ProgressChart, { rows });
    expect(container.querySelectorAll("path.done").length).toBe(2);
    await fireEvent.mouseEnter(container.querySelectorAll("rect.hit")[1]);
    const tip = container.querySelector(".tooltip")!.textContent!.replace(/\s+/g, " ");
    expect(tip).toContain("Sprint 1");
    expect(tip).toContain("Done 18");
    expect(tip).toContain("Still to do 30");
  });
});
