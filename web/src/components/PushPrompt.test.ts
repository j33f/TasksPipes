import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";

const push = vi.hoisted(() => ({
  pushSupported: vi.fn(() => true),
  currentSubscription: vi.fn(async () => null as unknown),
  enablePush: vi.fn(async () => true),
}));
vi.mock("../lib/push", () => push);

import PushPrompt from "./PushPrompt.svelte";

let permission: NotificationPermission;
beforeEach(() => {
  permission = "default";
  vi.stubGlobal("Notification", { get permission() { return permission; } });
  localStorage.clear();
  push.currentSubscription.mockResolvedValue(null);
  push.enablePush.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("push notifications prompt", () => {
  it("asks on a device the browser has not asked yet, and turns them on from the click", async () => {
    render(PushPrompt);
    await fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    expect(push.enablePush).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull();
  });

  it("asks again a month after \"Not now\"", async () => {
    render(PushPrompt);
    await fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    render(PushPrompt);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    localStorage.setItem("tp:pushPromptDismissed", String(Date.now() - 31 * 24 * 3600_000));
    cleanup();
    render(PushPrompt);
    expect(await screen.findByRole("button", { name: "Turn on notifications" })).toBeTruthy();
  });

  it("does not ask once the browser has an answer, or when this device already gets them", async () => {
    permission = "denied";
    render(PushPrompt);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    permission = "default";
    push.currentSubscription.mockResolvedValue({ endpoint: "https://push.example/1" });
    render(PushPrompt);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
