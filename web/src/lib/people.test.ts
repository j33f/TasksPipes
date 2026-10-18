import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import { awaitingSignIn, inviteColleague } from "./people";
import { app } from "./app.svelte";
import SpaceSelect from "../components/SpaceSelect.svelte";
import type { SpaceSummary } from "./types";

let answer: unknown;
let calls: string[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.spaces = [];
  app.toastMessage = null;
});

const person = (over: Partial<SpaceSummary>): SpaceSummary => ({
  id: "s", kind: "user", userId: "u", name: "Dave", description: "", color: null, avatarUrl: null, active: true, guest: false,
  myRole: null, memberCount: 0, incomingCount: null, pipeCount: 0, ...over,
});

describe("Outline colleagues who never signed in", () => {
  it("are those not signed in and not invited by e-mail", () => {
    expect(awaitingSignIn({ active: false, guest: false })).toBe(true);
    expect(awaitingSignIn({ active: false, guest: true })).toBe(false);
    expect(awaitingSignIn({ active: true, guest: false })).toBe(false);
  });

  it("cannot be chosen as recipients", () => {
    app.spaces = [person({ id: "s-dave", name: "Dave", active: false }), person({ id: "s-bob", name: "Bob" })];
    render(SpaceSelect, {});
    expect((screen.getByRole("option", { name: "Dave (has not signed in yet)" }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: "Bob" }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("are invited by e-mail when the instance sends some", async () => {
    answer = { sent: true };
    await inviteColleague("u-dave", "Dave");
    expect(calls).toEqual(["POST /api/users/u-dave/invite"]);
    expect(app.toastMessage?.message).toBe("Invitation sent to Dave");
  });

  it("otherwise get a link, copied to give them", async () => {
    answer = { sent: false, link: "https://tasks.example.com" };
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await inviteColleague("u-dave", "Dave");
    expect(writeText).toHaveBeenCalledWith("https://tasks.example.com");
    expect(app.toastMessage?.message).toBe("Link copied: give it to Dave, who signs in with Outline");
  });
});
