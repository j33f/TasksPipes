import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import AccountModal from "./AccountModal.svelte";
import { app } from "../lib/app.svelte";
import type { Me } from "../lib/types";

const me = (notifications: boolean): Me => ({
  user: { id: "u", name: "Alice", avatarUrl: null, email: "alice@example.com", kind: "outline", totp: false, locale: null, theme: null },
  personalSpaceId: "s",
  outlineUrl: "https://outline.test",
  features: { invitations: true, notifications },
  ...(notifications
    ? { notificationPrefs: { received: "immediate", assigned: "immediate", refused: "immediate", comment: "digest", due: "immediate", dueHour: 8 } }
    : {}),
});

let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    const answer = url.endsWith("/me/notifications") ? { notificationPrefs: { ...me(true).notificationPrefs, ...body } } : [];
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
});

describe("e-mail notification settings", () => {
  it("are hidden when the instance has no e-mail", () => {
    app.me = me(false);
    render(AccountModal, { onclose: () => {} });
    expect(screen.queryByText("E-mail notifications")).toBeNull();
  });

  it("show each choice and save a change at once", async () => {
    app.me = me(true);
    render(AccountModal, { onclose: () => {} });
    expect(screen.getByText("E-mail notifications")).toBeTruthy();
    const comments = screen.getByRole("group", { name: "A comment on a task I wrote or own" });
    const digest = [...comments.querySelectorAll("button")].find((b) => b.textContent === "Daily digest")!;
    expect(digest.classList.contains("active")).toBe(true);

    const off = [...comments.querySelectorAll("button")].find((b) => b.textContent === "Off")!;
    await userEvent.click(off);
    expect(calls.find((c) => c.url.endsWith("/me/notifications"))).toMatchObject({ method: "PUT", body: { comment: "off" } });
    expect(off.classList.contains("active")).toBe(true);
  });

  it("let the morning reminder hour be chosen, or the reminder turned off", async () => {
    app.me = me(true);
    render(AccountModal, { onclose: () => {} });
    const select = screen.getByRole("combobox", { name: "My due dates" }) as HTMLSelectElement;
    expect(select.value).toBe("8");
    await userEvent.selectOptions(select, "7");
    expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { due: "immediate", dueHour: 7 } });
    await userEvent.selectOptions(select, "off");
    expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { due: "off" } });
  });
});
