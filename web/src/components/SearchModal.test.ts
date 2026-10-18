import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import SearchModal from "./SearchModal.svelte";
import { app } from "../lib/app.svelte";
import { router } from "../lib/router.svelte";
import type { Me, SearchResult } from "../lib/types";

const me: Me = {
  user: { id: "u-me", name: "Alice", avatarUrl: null, email: "alice@example.com", kind: "outline", totp: false, locale: null, theme: null },
  personalSpaceId: "s",
  outlineUrl: "https://outline.test",
  features: { invitations: true, notifications: false },
};
const hit = (over: Partial<SearchResult> = {}): SearchResult => ({
  id: "t1", number: 12, key: "TP-12", title: "Order the kumquats", status: "ongoing", taskType: "task",
  space: { id: "sp", name: "Trainers", kind: "team" }, pipe: { id: "p", name: "Board", archived: false }, column: "In progress",
  owner: { id: "u-me", name: "Alice", avatarUrl: null }, confidential: false, snippet: "call the \u0002kumquat\u0003 farm", ...over,
});

let urls: string[];
let answer: SearchResult[];
beforeEach(() => {
  urls = [];
  answer = [];
  app.me = me;
  app.users = [{ id: "u-bob", name: "Bob", avatarUrl: null, spaceId: "sb", active: true, guest: false }];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
  app.users = [];
});

describe("search dialog", () => {
  it("shows results with their path and the matched words", async () => {
    answer = [hit(), hit({ id: "t2", key: "TP-13", title: "Inbox one", pipe: null, column: null, snippet: null, confidential: true })];
    render(SearchModal, { onclose: () => {} });
    await userEvent.type(screen.getByRole("searchbox"), "kumquat");
    expect(await screen.findByText("Order the kumquats")).toBeTruthy();
    expect(screen.getByText("Trainers › Board › In progress")).toBeTruthy();
    expect(screen.getByText("kumquat", { selector: "mark" })).toBeTruthy();
    // Incoming bucket, confidential: no column, no excerpt.
    expect(screen.getByText("Trainers › Incoming")).toBeTruthy();
    expect(screen.getByText("Confidential")).toBeTruthy();
    expect(urls.at(-1)).toBe("/api/search?q=kumquat");
  });

  it("sends the filters", async () => {
    render(SearchModal, { onclose: () => {} });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "open");
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "u-bob");
    await userEvent.type(screen.getByRole("searchbox"), "plan");
    expect(await screen.findByText("No task found")).toBeTruthy();
    expect(urls.at(-1)).toBe("/api/search?q=plan&status=open&owner=u-bob");
  });

  it("opens the chosen task with the keyboard", async () => {
    answer = [hit(), hit({ id: "t2", key: "TP-13", title: "Second" })];
    const onclose = vi.fn();
    render(SearchModal, { onclose });
    await userEvent.type(screen.getByRole("searchbox"), "k");
    await screen.findByText("Second");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onclose).toHaveBeenCalled();
    expect(router.params.get("task")).toBe("t2");
  });

  it("asks nothing for an empty search", async () => {
    render(SearchModal, { onclose: () => {} });
    await userEvent.type(screen.getByRole("searchbox"), "   ");
    await new Promise((r) => setTimeout(r, 300));
    expect(urls).toEqual([]);
  });
});
