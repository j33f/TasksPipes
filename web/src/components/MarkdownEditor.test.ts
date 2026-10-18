import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import MarkdownEditor from "./MarkdownEditor.svelte";

const BOB = "22222222-2222-4222-8222-222222222222";
afterEach(cleanup);

describe("Markdown editor mentions", () => {
  it("suggest people after @ and insert the chosen one", async () => {
    const mentions = vi.fn(async (q: string) => (q.startsWith("b") ? [{ id: BOB, name: "Bob Durand", avatarUrl: null, spaceId: "s" }] : []));
    render(MarkdownEditor, { value: "", mentions });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(area, "Hi @bo");
    expect(await screen.findByRole("option")).toBeTruthy();
    expect(mentions).toHaveBeenLastCalledWith("bo");
    await userEvent.keyboard("{Enter}");
    expect(area.value).toBe(`Hi @[Bob Durand](mention:${BOB}) `);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("suggest nothing without a list of people", async () => {
    render(MarkdownEditor, { value: "" });
    await userEvent.type(screen.getByRole("textbox"), "@bo");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
