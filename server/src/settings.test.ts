import { afterEach, describe, expect, it } from "vitest";
import { lockedSetting, setStoredSettings, setting, settingDef } from "./settings-store.js";
import { canSignIn, cleanSetting } from "./settings.js";

afterEach(() => {
  delete process.env.SMTP_HOST;
  setStoredSettings(new Map());
});

describe("settings", () => {
  it("come from the environment (which locks them), else the database, else their default", () => {
    expect(setting("smtp.port")).toBe(587);
    setStoredSettings(new Map([["smtp.host", "db.example.test"]]));
    expect(setting("smtp.host")).toBe("db.example.test");
    expect(lockedSetting("smtp.host")).toBe(false);
    process.env.SMTP_HOST = "env.example.test";
    expect(setting("smtp.host")).toBe("env.example.test");
    expect(lockedSetting("smtp.host")).toBe(true);
    // An empty variable counts as unset.
    process.env.SMTP_HOST = "";
    expect(setting("smtp.host")).toBe("db.example.test");
    expect(setting("smtp.host", { "smtp.host": "proposed.test" })).toBe("proposed.test");
  });

  it("are checked by kind", () => {
    expect(cleanSetting(settingDef("signin.emailDomains")!, "@Example.com, example.org example.com")).toEqual(["example.com", "example.org"]);
    expect(cleanSetting(settingDef("outline.allowedHosts")!, ["*.example.com"])).toEqual(["*.example.com"]);
    expect(cleanSetting(settingDef("outline.url")!, "https://docs.example.com/")).toBe("https://docs.example.com");
    expect(() => cleanSetting(settingDef("outline.url")!, "https://user:pass@docs.example.com")).toThrow();
    expect(() => cleanSetting(settingDef("outline.enabled")!, "yes")).toThrow();
    expect(cleanSetting(settingDef("smtp.from")!, "TasksPipes <tasks@example.com>")).toBe("TasksPipes <tasks@example.com>");
  });

  it("tell who could still sign in", () => {
    const base: Record<string, unknown> = {
      "outline.enabled": true, "outline.url": "https://docs.example.com", "outline.apiKeyLogin": true, "outline.allowedHosts": [],
      "outline.oauthClientId": "", "outline.oauthClientSecret": "", "smtp.host": "", "smtp.from": "", "smtp.user": "",
      "oidc.enabled": true, "oidc.issuer": "", "oidc.clientId": "",
    };
    const get = (over: Record<string, unknown> = {}) => <T>(k: string) => ({ ...base, ...over })[k] as T;
    const outline = { auth_kind: "outline", outline_url: "https://docs.example.com" };
    expect(canSignIn(outline, get())).toBe(true);
    expect(canSignIn(outline, get({ "outline.enabled": false }))).toBe(false);
    expect(canSignIn(outline, get({ "outline.apiKeyLogin": false }))).toBe(false);
    expect(canSignIn(outline, get({ "outline.apiKeyLogin": false, "outline.oauthClientId": "i", "outline.oauthClientSecret": "s" }))).toBe(true);
    const other = { auth_kind: "outline", outline_url: "https://other.example.org" };
    expect(canSignIn(other, get({ "outline.allowedHosts": ["*.example.org"] }))).toBe(true);
    expect(canSignIn(other, get({ "outline.allowedHosts": ["docs.example.com"] }))).toBe(false);
    expect(canSignIn({ auth_kind: "email" }, get())).toBe(false);
    expect(canSignIn({ auth_kind: "email" }, get({ "smtp.host": "smtp", "smtp.from": "a@b.c" }))).toBe(true);
    const sso = { auth_kind: "oidc", oidc_sub: "1", oidc_issuer: "https://idp" };
    expect(canSignIn(sso, get({ "oidc.issuer": "https://idp", "oidc.clientId": "c" }))).toBe(true);
    expect(canSignIn(sso, get({ "oidc.issuer": "https://idp", "oidc.clientId": "c", "oidc.enabled": false }))).toBe(false);
  });
});
