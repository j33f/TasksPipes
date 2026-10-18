/** @mentions, written `@[Name](mention:<id>)` in Markdown: shown as a link to the person's space. */
import { api } from "./api";
import { app } from "./app.svelte";

export interface Mentionable {
  id: string;
  name: string;
  avatarUrl: string | null;
  spaceId: string | null;
}

const MENTION = /@\[([^\]\n]{1,100})\]\(mention:([0-9a-f-]{36})\)/gi;
const escapeMd = (s: string) => s.replace(/[\\`*_[\]()#<>!|~]/g, "\\$&");

/** Markdown with mentions turned into links to people one sees (others keep their name, in bold). */
export function withMentions(src: string): string {
  return src.replace(MENTION, (_all, name: string, id: string) => {
    const space = app.users.find((u) => u.id === id)?.spaceId;
    return space ? `[@${escapeMd(name)}](/spaces/${space})` : `**@${escapeMd(name)}**`;
  });
}

/** The text a mention inserts. */
export const mentionText = (p: Pick<Mentionable, "id" | "name">) => `@[${p.name.replace(/[\]\n]/g, "")}](mention:${p.id}) `;

/** The "@word" being typed right before the caret, if any: where it starts and what it holds. */
export function typedMention(text: string, caret: number): { start: number; query: string } | null {
  const m = text.slice(0, caret).match(/(^|[\s(])@([\p{L}\p{N}][\p{L}\p{N} .'-]{0,30})?$/u);
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, query };
}

/** Who may be mentioned on a task (people who can open it). */
export const mentionableOn = (taskId: string) => (q: string) =>
  api.get<Mentionable[]>(`/tasks/${taskId}/mentionable?q=${encodeURIComponent(q)}`);
