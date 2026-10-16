import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Checklist from "./Checklist.svelte";
import { prefs } from "../lib/i18n.svelte";
import type { ChecklistItem } from "../lib/types";

afterEach(() => {
  cleanup();
  prefs.set({ locale: null });
});

const items: ChecklistItem[] = [
  { id: "a", text: "Posters", done: false, position: 1 },
  { id: "b", text: "Room", done: true, position: 2, doneBy: "Bob" },
];
const handlers = () => ({ onadd: vi.fn(), ontoggle: vi.fn(), onrename: vi.fn(), ondelete: vi.fn(), onmove: vi.fn() });

describe("Checklist", () => {
  it("shows the items and the progress", () => {
    prefs.set({ locale: "en" });
    render(Checklist, { items, ...handlers() });
    expect(screen.getByText("Posters")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect((screen.getByLabelText("Room") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTitle("Checked by Bob")).toBeTruthy();
  });

  it("adds an item on Enter and one per pasted line", async () => {
    prefs.set({ locale: "en" });
    const h = handlers();
    render(Checklist, { items: [], ...h });
    const input = screen.getByPlaceholderText("Add a sub-task… (Enter)");
    await userEvent.type(input, "Coffee{Enter}");
    expect(h.onadd).toHaveBeenCalledWith("Coffee");
    await fireEvent.paste(input, { clipboardData: { getData: () => "- [ ] One\n- [x] Two\n\n* Three" } });
    expect(h.onadd.mock.calls.map((c) => c[0])).toEqual(["Coffee", "One", "Two", "Three"]);
  });

  it("toggles, renames and deletes", async () => {
    prefs.set({ locale: "en" });
    const h = handlers();
    render(Checklist, { items, ...h });
    await userEvent.click(screen.getByLabelText("Posters"));
    expect(h.ontoggle).toHaveBeenCalledWith(items[0]);
    await userEvent.click(screen.getAllByTitle("Delete")[1]);
    expect(h.ondelete).toHaveBeenCalledWith(items[1]);
    await userEvent.click(screen.getAllByTitle("Rename")[0]);
    const edit = screen.getByDisplayValue("Posters");
    await userEvent.clear(edit);
    await userEvent.type(edit, "Big posters{Enter}");
    expect(h.onrename).toHaveBeenCalledWith(items[0], "Big posters");
  });

  it("is read-only when not editable", () => {
    prefs.set({ locale: "fr" });
    render(Checklist, { items, editable: false, ...handlers() });
    expect(screen.queryByPlaceholderText("Ajouter une sous-tâche… (Entrée)")).toBeNull();
    expect((screen.getByLabelText("Posters") as HTMLInputElement).disabled).toBe(true);
  });
});
