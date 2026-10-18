import { afterEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { isInstanceAdmin } from "./admin.js";

const saved = { adminEmails: config.adminEmails, outlineUrl: config.outlineUrl };
afterEach(() => Object.assign(config, saved));

describe("administrators of the instance", () => {
  it("are the proven addresses of ADMIN_EMAILS", () => {
    Object.assign(config, { adminEmails: ["boss@example.com"], outlineUrl: "https://docs.example.com" });
    expect(isInstanceAdmin({ email: "Boss@Example.com", auth_kind: "email", outline_url: null })).toBe(true);
    expect(isInstanceAdmin({ email: "boss@example.com", auth_kind: "outline", outline_url: "https://docs.example.com" })).toBe(true);
    // Accounts of the configured server made before servers were stored.
    expect(isInstanceAdmin({ email: "boss@example.com", auth_kind: "outline", outline_url: null })).toBe(true);
    expect(isInstanceAdmin({ email: "other@example.com", auth_kind: "email", outline_url: null })).toBe(false);
  });

  it("never come from another Outline server, which could claim any address", () => {
    Object.assign(config, { adminEmails: ["boss@example.com"], outlineUrl: "https://docs.example.com" });
    expect(isInstanceAdmin({ email: "boss@example.com", auth_kind: "outline", outline_url: "https://evil.example.net" })).toBe(false);
    Object.assign(config, { outlineUrl: "" });
    expect(isInstanceAdmin({ email: "boss@example.com", auth_kind: "outline", outline_url: "https://docs.example.com" })).toBe(false);
  });

  it("are no one without ADMIN_EMAILS, nor system accounts", () => {
    Object.assign(config, { adminEmails: [] });
    expect(isInstanceAdmin({ email: "boss@example.com", auth_kind: "email", outline_url: null })).toBe(false);
    Object.assign(config, { adminEmails: ["boss@example.com"] });
    expect(isInstanceAdmin({ email: "boss@example.com", auth_kind: "system", outline_url: null })).toBe(false);
    expect(isInstanceAdmin(null)).toBe(false);
  });
});
