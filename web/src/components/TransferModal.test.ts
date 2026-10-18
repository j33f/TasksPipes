import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import TransferModal from "./TransferModal.svelte";
import type { ImportPreview, PipeDetail } from "../lib/types";

const pipe = (over: Partial<PipeDetail> = {}) => ({
  id: "p1", name: "Sales", kind: "general", canManage: true, archived: false, ...over,
}) as PipeDetail;

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  headers: ["Name", "State"], mapping: ["title", "column"],
  targets: [{ id: "ignore", label: "(ignore)" }, { id: "title", label: "Title" }, { id: "column", label: "Column" }],
  taskTypes: [{ id: "task", label: "Task" }], columns: [{ id: "backlog", label: "Backlog" }, { id: "done", label: "Done" }],
  columnValues: [], count: 1, tasks: [{ line: 2, title: "Imported", stage: "backlog", owner: null, dueDate: null }],
  errors: [], errorCount: 0, ...over,
});

let calls: { url: string; body: Record<string, unknown> }[];
let answer: ImportPreview;
beforeEach(() => {
  calls = [];
  answer = preview();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    const json = url.endsWith("/import") ? { created: 1 } : answer;
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const choose = async (name: string, text: string) => {
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  await userEvent.upload(input, new File([text], name, { type: "text/csv" }));
};

describe("export and import", () => {
  it("offers the exports to everyone who sees the pipe, the import to its members", () => {
    render(TransferModal, { pipe: pipe({ canManage: false }), onclose: () => {} });
    expect(screen.getByRole("link", { name: "CSV" }).getAttribute("href")).toBe("/api/pipes/p1/export");
    expect(screen.getByRole("link", { name: "JSON" }).getAttribute("href")).toBe("/api/pipes/p1/export?format=json");
    expect(screen.queryByText("Import tasks")).toBeNull();
  });

  it("previews a file, lets the columns be mapped, then imports it", async () => {
    const onclose = vi.fn();
    render(TransferModal, { pipe: pipe(), onclose });
    await choose("tasks.csv", "Name,State\nImported,Backlog\n");
    expect(await screen.findByText("Imported")).toBeTruthy();
    expect(calls[0]).toMatchObject({ url: "/api/pipes/p1/import/preview", body: { source: "csv", content: "Name,State\nImported,Backlog\n" } });
    await userEvent.selectOptions(screen.getAllByLabelText("Goes to")[1], "ignore");
    await vi.waitFor(() => expect(calls.at(-1)!.body.mapping).toEqual({ 1: "ignore" }));
    await userEvent.click(screen.getByRole("button", { name: "Import 1 task" }));
    expect(calls.at(-1)!.url).toBe("/api/pipes/p1/import");
    expect(onclose).toHaveBeenCalled();
  });

  it("shows the lines to correct and imports nothing meanwhile", async () => {
    answer = preview({ count: 0, tasks: [], errors: [{ line: 3, message: "Invalid due date: someday" }], errorCount: 1 });
    render(TransferModal, { pipe: pipe(), onclose: () => {} });
    await choose("tasks.csv", "Name\nx\n");
    expect(await screen.findByText("Line 3: Invalid due date: someday")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import 0 tasks" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks where values matching no column go, and reads Trello boards", async () => {
    answer = preview({ columnValues: [{ value: "Doing", column: "" }] });
    render(TransferModal, { pipe: pipe(), onclose: () => {} });
    await choose("board.json", "{}");
    await userEvent.selectOptions(await screen.findByLabelText("Doing"), "done");
    await vi.waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ source: "trello", columnValues: { Doing: "done" } }));
  });
});
