/**
 * The AI assistant's connection (Administration › Settings › AI assistant): one AI for the whole instance, reached
 * with the OpenAI or the Anthropic API. A well-known provider fills its address and API; "Other" takes any
 * compatible server (Ollama, a proxy…). The key stays on the server (encrypted with the other settings); the models
 * are listed from the provider. Confidential pipes are never sent to it (the features using it check that).
 */
import { bad } from "./errors.js";
import net from "node:net";
import { getText, guardedLookup, isPrivateIp, postJson } from "./net.js";
import { setting } from "./settings-store.js";

export type AiApi = "openai" | "anthropic";

export interface AiProvider {
  id: string;
  name: string;
  api: AiApi;
  /** Base address, up to the API version (".../v1"). */
  url: string;
}

export const AI_PROVIDERS: AiProvider[] = [
  { id: "anthropic", name: "Anthropic (Claude)", api: "anthropic", url: "https://api.anthropic.com/v1" },
  { id: "openai", name: "OpenAI", api: "openai", url: "https://api.openai.com/v1" },
  { id: "mistral", name: "Mistral AI", api: "openai", url: "https://api.mistral.ai/v1" },
  { id: "openrouter", name: "OpenRouter", api: "openai", url: "https://openrouter.ai/api/v1" },
  { id: "ollama", name: "Ollama", api: "openai", url: "http://localhost:11434/v1" },
];
export const AI_PROVIDER_IDS = [...AI_PROVIDERS.map((p) => p.id), "other"];
export const AI_EFFORTS = ["low", "medium", "high"];

export interface AiConfig {
  provider: string;
  api: AiApi;
  url: string;
  apiKey: string;
  model: string;
  effort: string;
  allowPrivate: boolean;
}

type Get = <T>(key: string) => T;

/** The connection from the settings (`get` may read values not saved yet), or null when there is none. */
export function aiConfig(get: Get = (k) => setting(k)): AiConfig | null {
  const provider = get<string>("ai.provider");
  if (!provider) return null;
  const preset = AI_PROVIDERS.find((p) => p.id === provider);
  const url = (get<string>("ai.url") || preset?.url || "").replace(/\/+$/, "");
  if (!url) return null;
  return {
    provider,
    api: preset?.api ?? (get<string>("ai.api") === "anthropic" ? "anthropic" : "openai"),
    url,
    apiKey: get<string>("ai.apiKey") ?? "",
    model: get<string>("ai.model") ?? "",
    effort: get<string>("ai.effort") ?? "",
    allowPrivate: get<boolean>("ai.allowPrivate") === true,
  };
}

/** Whether the assistant can be used: an AI connected with a model chosen. */
export const aiReady = () => Boolean(aiConfig()?.model);

const ANTHROPIC_VERSION = "2023-06-01";

function headers(cfg: AiConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (cfg.api === "anthropic") {
    h["anthropic-version"] = ANTHROPIC_VERSION;
    if (cfg.apiKey) h["x-api-key"] = cfg.apiKey;
  } else if (cfg.apiKey) {
    h.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return h;
}

/** The provider's error, short and without the key. */
function failure(status: number, text: string, cfg: AiConfig) {
  let message: unknown = text;
  try {
    const j = JSON.parse(text);
    message = j?.error?.message ?? j?.message ?? j?.error ?? text;
  } catch { /* not JSON: the text itself */ }
  const clean = String(typeof message === "string" ? message : JSON.stringify(message)).replaceAll(cfg.apiKey || "\u0000", "***").slice(0, 300);
  return bad("The AI answered {status}: {error}", { status, error: clean });
}

function unreachable(err: Error & { code?: string }) {
  if (err.code === "EPRIVATE") return bad("This AI is on an internal address: allow internal addresses first");
  return bad("The AI could not be reached: {error}", { error: String(err.message ?? err).slice(0, 200) });
}

const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    throw bad("The AI's answer could not be read");
  }
};

/** An address written as an IP is not looked up: it is checked here (a name is checked when connecting). */
function assertAddressAllowed(cfg: AiConfig) {
  const host = new URL(cfg.url).hostname.replace(/^\[|\]$/g, "");
  if (!cfg.allowPrivate && (host === "localhost" || (net.isIP(host) && isPrivateIp(host)))) {
    throw bad("This AI is on an internal address: allow internal addresses first");
  }
}

/** The models the AI offers, sorted. */
export async function listModels(cfg: AiConfig): Promise<{ id: string; name: string }[]> {
  assertAddressAllowed(cfg);
  let res;
  try {
    res = await getText(`${cfg.url}/models${cfg.api === "anthropic" ? "?limit=1000" : ""}`, headers(cfg), guardedLookup(cfg.allowPrivate));
  } catch (err) {
    throw unreachable(err as Error);
  }
  if (res.status !== 200) throw failure(res.status, res.text, cfg);
  const list = parse(res.text)?.data;
  if (!Array.isArray(list)) throw bad("The AI's answer could not be read");
  return list
    .filter((m) => m && typeof m.id === "string")
    .map((m) => ({ id: String(m.id).slice(0, 200), name: String(m.display_name ?? m.name ?? m.id).slice(0, 200) }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 1000);
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/** The request body for one answer, in the AI's API. */
export function completionBody(cfg: AiConfig, system: string, messages: AiMessage[], maxTokens: number): Record<string, unknown> {
  if (cfg.api === "anthropic") {
    return { model: cfg.model, max_tokens: maxTokens, system, messages, ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}) };
  }
  return {
    model: cfg.model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages],
    ...(cfg.effort ? { reasoning_effort: cfg.effort } : {}),
  };
}

/** The text of an answer, in the AI's API. */
export function completionText(cfg: AiConfig, j: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = j as any;
  const text = cfg.api === "anthropic"
    ? (Array.isArray(a?.content) ? a.content.filter((b: { type?: string }) => b?.type === "text").map((b: { text?: string }) => b.text ?? "").join("") : undefined)
    : a?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw bad("The AI's answer could not be read");
  return text;
}

/** One answer of the AI, as text. */
export async function complete(cfg: AiConfig, system: string, messages: AiMessage[], { maxTokens = 4000, timeoutMs = 120_000 } = {}): Promise<string> {
  if (!cfg.model) throw bad("Choose the AI's model first");
  assertAddressAllowed(cfg);
  let res;
  try {
    res = await postJson(`${cfg.url}/${cfg.api === "anthropic" ? "messages" : "chat/completions"}`, headers(cfg),
      JSON.stringify(completionBody(cfg, system, messages, maxTokens)), guardedLookup(cfg.allowPrivate), { timeoutMs });
  } catch (err) {
    throw unreachable(err as Error);
  }
  if (res.status !== 200) throw failure(res.status, res.text, cfg);
  return completionText(cfg, parse(res.text));
}
