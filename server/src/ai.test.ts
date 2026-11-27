import { describe, expect, it } from "vitest";
import { aiConfig, completionBody, completionText, type AiConfig } from "./ai.js";

const from = (values: Record<string, unknown>) => <T>(k: string) => values[k] as T;
const base: AiConfig = { provider: "x", api: "openai", url: "https://ai.example.com/v1", apiKey: "k", model: "m", effort: "", allowPrivate: false };

describe("AI connection", () => {
  it("is off without a provider", () => {
    expect(aiConfig(from({ "ai.provider": "" }))).toBeNull();
  });

  it("takes a known provider's address and API", () => {
    const cfg = aiConfig(from({ "ai.provider": "anthropic", "ai.url": "", "ai.api": "openai", "ai.apiKey": "k", "ai.model": "claude-opus-5-5" }));
    expect(cfg).toMatchObject({ api: "anthropic", url: "https://api.anthropic.com/v1", model: "claude-opus-5-5" });
  });

  it("takes the address and API given for another server", () => {
    expect(aiConfig(from({ "ai.provider": "other", "ai.url": "http://llm.local/v1/", "ai.api": "anthropic" }))).toMatchObject({
      api: "anthropic", url: "http://llm.local/v1",
    });
    expect(aiConfig(from({ "ai.provider": "other", "ai.url": "" }))).toBeNull();
  });
});

describe("AI requests", () => {
  const msgs = [{ role: "user" as const, content: "Hi" }];

  it("speak the OpenAI API", () => {
    expect(completionBody({ ...base, effort: "low" }, "Be brief", msgs, 100)).toEqual({
      model: "m", max_tokens: 100, messages: [{ role: "system", content: "Be brief" }, ...msgs], reasoning_effort: "low",
    });
    expect(completionText(base, { choices: [{ message: { content: "Hello" } }] })).toBe("Hello");
  });

  it("speak the Anthropic API", () => {
    const cfg = { ...base, api: "anthropic" as const };
    expect(completionBody({ ...cfg, effort: "high" }, "Be brief", msgs, 100)).toEqual({
      model: "m", max_tokens: 100, system: "Be brief", messages: msgs, output_config: { effort: "high" },
    });
    expect(completionBody(cfg, "s", msgs, 10)).not.toHaveProperty("output_config");
    expect(completionText(cfg, { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hel" }, { type: "text", text: "lo" }] })).toBe("Hello");
  });

  it("refuse an answer they cannot read", () => {
    expect(() => completionText(base, { choices: [] })).toThrow();
    expect(() => completionText({ ...base, api: "anthropic" }, { error: "x" })).toThrow();
  });
});
