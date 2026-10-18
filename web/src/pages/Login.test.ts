import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import Login from "./Login.svelte";

let oidc: { name: string } | null;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ oauth: false, apiKey: false, outlineUrl: null, mail: true, signup: true, oidc }),
    { status: 200, headers: { "content-type": "application/json" } }
  )));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sign-in page", () => {
  it("offers the company's sign-in when it is set up", async () => {
    oidc = { name: "Acme SSO" };
    render(Login);
    expect((await screen.findByRole("link", { name: "Continue with Acme SSO" })).getAttribute("href")).toBe("/auth/oidc");
  });

  it("does not otherwise", async () => {
    oidc = null;
    render(Login);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("link", { name: /Continue with/ })).toBeNull();
  });
});
