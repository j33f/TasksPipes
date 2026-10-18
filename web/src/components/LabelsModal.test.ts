import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import LabelsModal from "./LabelsModal.svelte";

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = (init?.method ?? "GET") === "GET" ? [{ id: "l1", name: "Client", color: "#2bc2ff", position: 1 }] : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("labels dialog", () => {
  it("lists, adds, renames and deletes the labels of a space", async () => {
    render(LabelsModal, { spaceId: "s1", onclose: () => {} });
    const name = await screen.findByLabelText("Name of “Client”");
    await userEvent.type(screen.getByLabelText("New label"), "Internal");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/spaces/s1/labels", body: { name: "Internal", color: "#ed2651" } });
    await userEvent.clear(name);
    await userEvent.type(name, "Customer{Enter}");
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/labels/l1", body: { name: "Customer" } });
    await userEvent.click(screen.getByTitle("Delete"));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/labels/l1");
  });
});
