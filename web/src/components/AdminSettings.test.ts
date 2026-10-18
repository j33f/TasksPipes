import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import AdminSettings from "./AdminSettings.svelte";

const settings = [
  { key: "smtp.host", section: "smtp", kind: "string", locked: false, env: "SMTP_HOST", default: "", value: "" },
  { key: "smtp.pass", section: "smtp", kind: "secret", locked: false, env: "SMTP_PASS", default: "", value: null, isSet: true },
  { key: "smtp.from", section: "smtp", kind: "string", locked: false, env: "MAIL_FROM", default: "", value: "" },
  { key: "outline.enabled", section: "outline", kind: "bool", locked: false, env: "OUTLINE_ENABLED", default: true, value: true },
  { key: "outline.url", section: "outline", kind: "url", locked: true, env: "OUTLINE_URL", default: "", value: "https://docs.example.com" },
  { key: "signin.emailDomains", section: "signin", kind: "list", locked: false, env: "EMAIL_DOMAINS", default: [], value: ["example.com"] },
];

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = url.endsWith("/test-mail") ? { ok: true, to: "admin@example.com" }
      : { settings, oauthRedirect: "https://tasks.test/auth/outline/callback", oidcRedirect: "https://tasks.test/auth/oidc/callback" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("instance settings page", () => {
  it("shows locked settings read-only, and secrets without their value", async () => {
    render(AdminSettings);
    const url = (await screen.findByLabelText("Main Outline server")) as HTMLInputElement;
    expect(url.disabled).toBe(true);
    expect(screen.getByText("Set by the server (OUTLINE_URL)")).toBeTruthy();
    const pass = screen.getByLabelText("Password") as HTMLInputElement;
    expect(pass.value).toBe("");
    expect(pass.placeholder).toBe("Set: type a new value to replace it");
  });

  it("saves only what changed in a section, lists as lists", async () => {
    render(AdminSettings);
    await userEvent.type(await screen.findByLabelText("SMTP server"), "smtp.example.com");
    const smtp = document.querySelector('[data-section="smtp"]') as HTMLElement;
    await userEvent.click(within(smtp).getByRole("button", { name: "Save" }));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ settings: { "smtp.host": "smtp.example.com" } });

    const domains = screen.getByLabelText("E-mail domains allowed to sign up or be invited");
    await userEvent.clear(domains);
    await userEvent.type(domains, "example.com{Enter}example.org");
    const signin = document.querySelector('[data-section="signin"]') as HTMLElement;
    await userEvent.click(within(signin).getByRole("button", { name: "Save" }));
    expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ settings: { "signin.emailDomains": ["example.com", "example.org"] } });
  });

  it("sends a test e-mail", async () => {
    render(AdminSettings);
    await userEvent.click(await screen.findByRole("button", { name: "Send me a test e-mail" }));
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/admin/settings/test-mail" });
  });
});
