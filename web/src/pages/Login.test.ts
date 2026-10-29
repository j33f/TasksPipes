import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import Login from "./Login.svelte";

let oidc: { name: string } | null;
let outline: { oauth: boolean; apiKey: boolean; outlineUrl: string | null };
beforeEach(() => {
  oidc = null;
  outline = { oauth: false, apiKey: false, outlineUrl: null };
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ ...outline, mail: true, signup: true, oidc }),
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

  it("signs in with the instance's Outline server without asking for one when OAuth is set up", async () => {
    outline = { oauth: true, apiKey: true, outlineUrl: "https://docs.example.com" };
    render(Login);
    expect((await screen.findByRole("link", { name: "Continue with Outline" })).getAttribute("href")).toBe("/auth/outline");
    expect(screen.queryByLabelText("Outline server")).toBeNull();
    expect(screen.getByRole("link", { name: /docs\.example\.com/ }).getAttribute("href")).toBe("https://docs.example.com/settings/api-and-apps");
  });

  it("still lets people pick another server for an API key", async () => {
    outline = { oauth: true, apiKey: true, outlineUrl: "https://docs.example.com" };
    render(Login);
    await fireEvent.click(await screen.findByRole("button", { name: "Another Outline server?" }));
    expect(screen.getByLabelText("Server address")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Continue with Outline" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Back to docs.example.com" }));
    expect(screen.getByRole("link", { name: "Continue with Outline" })).toBeTruthy();
  });

  it("asks for the server when only API keys are allowed", async () => {
    outline = { oauth: false, apiKey: true, outlineUrl: null };
    render(Login);
    expect(await screen.findByLabelText("Server address")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Continue with Outline" })).toBeNull();
  });
});
