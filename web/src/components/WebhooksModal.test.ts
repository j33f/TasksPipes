import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import WebhooksModal from "./WebhooksModal.svelte";
import type { Webhook } from "../lib/types";

let hooks: Webhook[];
let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  calls = [];
  hooks = [{
    id: "h1", url: "https://example.com/hook", events: ["task.created"], active: true, format: "json", locale: "en", secret: "s3cr3t", createdAt: "2026-10-01T00:00:00Z",
    deliveries: [{ id: "9", event: "task.created", attempts: 2, createdAt: new Date().toISOString(), state: "failed", status: 500, error: "HTTP 500" }],
  }];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(method === "GET" ? hooks : { ...hooks[0], id: "h2" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("webhooks of a pipe", () => {
  it("list their deliveries, the secret shown on request", async () => {
    render(WebhooksModal, { pipeId: "p1", onclose: () => {} });
    expect(await screen.findByText("https://example.com/hook")).toBeTruthy();
    expect(screen.getByText("Given up (2)")).toBeTruthy();
    expect(screen.getByText("HTTP 500")).toBeTruthy();
    expect(screen.queryByText("s3cr3t")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("s3cr3t")).toBeTruthy();
  });

  it("are added with an address and events", async () => {
    render(WebhooksModal, { pipeId: "p1", onclose: () => {} });
    await screen.findByText("https://example.com/hook");
    await userEvent.type(screen.getByLabelText("Address"), "https://hooks.example.com/tp");
    const done = screen.getAllByLabelText("A task is done").at(-1)!;
    await userEvent.click(done);
    await userEvent.click(screen.getByRole("button", { name: "Add a webhook" }));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/pipes/p1/webhooks");
    // The defaults were created and done: done is now unchecked.
    expect(post.body).toEqual({ url: "https://hooks.example.com/tp", events: ["task.created"], format: "json" });
  });

  it("are turned off, tested and deleted", async () => {
    render(WebhooksModal, { pipeId: "p1", onclose: () => {} });
    await screen.findByText("https://example.com/hook");
    await userEvent.click(screen.getByLabelText("On"));
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual([
      "PATCH /api/webhooks/h1", "POST /api/webhooks/h1/ping", "DELETE /api/webhooks/h1",
    ]);
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ active: false });
  });

  it("post to a chat channel in a chosen format and language", async () => {
    render(WebhooksModal, { pipeId: "p1", onclose: () => {} });
    await screen.findByText("https://example.com/hook");
    await userEvent.selectOptions(screen.getByLabelText("Format"), "slack");
    await userEvent.selectOptions(screen.getAllByLabelText("Language of the messages").at(-1)!, "fr");
    await userEvent.type(screen.getByLabelText("Address"), "https://hooks.slack.com/services/T/B/X");
    await userEvent.click(screen.getByRole("button", { name: "Add a webhook" }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/pipes/p1/webhooks", body: { url: "https://hooks.slack.com/services/T/B/X", format: "slack", locale: "fr" },
    });
  });
});
