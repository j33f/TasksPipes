import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import Avatar from "./Avatar.svelte";
import StatusBadge from "./StatusBadge.svelte";
import AboutModal from "./AboutModal.svelte";
import { app } from "../lib/app.svelte";
import { prefs } from "../lib/i18n.svelte";

afterEach(() => {
  cleanup();
  prefs.set({ locale: null });
});

describe("Avatar", () => {
  it("shows initials when there is no picture", () => {
    render(Avatar, { user: { id: "u", name: "Alice Martin", avatarUrl: null } });
    expect(screen.getByText("AM")).toBeTruthy();
  });

  it("shows the picture when there is one", () => {
    const { container } = render(Avatar, { user: { id: "u", name: "Alice", avatarUrl: "/a.png" } });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/a.png");
  });
});

describe("StatusBadge", () => {
  it("shows the column of the pipe type, or the translated generic status", () => {
    app.pipeTypes = [{
      id: "general", label: "General", group: "G", description: "", color: "", icon: "pipe", taskTypes: [], templates: [],
      columns: [{ id: "doing", label: "Doing it", color: "#000", status: "ongoing" }],
    }];
    prefs.set({ locale: "fr" });
    render(StatusBadge, { task: { status: "ongoing", stage: "doing", pipe: { id: "p", name: "P", visibility: "private", kind: "general" } } });
    expect(screen.getByText("Doing it")).toBeTruthy();
    cleanup();
    render(StatusBadge, { task: { status: "blocked", stage: null, pipe: null } });
    expect(screen.getByText("Bloqué")).toBeTruthy();
  });
});

describe("AboutModal", () => {
  it("shows the version and links to the repository", () => {
    prefs.set({ locale: "en" });
    render(AboutModal, { onclose: () => {} });
    expect(screen.getByText(`Version ${__APP_VERSION__}`)).toBeTruthy();
    expect(screen.getByText("Source code on GitHub").closest("a")?.getAttribute("href")).toBe("https://github.com/j33f/TasksPipes");
  });
});
