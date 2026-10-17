import type { Status } from "./types";
import { intlLocale, t } from "./i18n.svelte";

/** Generic statuses; their labels are English source text, shown with t(). */
export const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "#66778F" },
  { id: "ready", label: "Ready to start", color: "#2BC2FF" },
  { id: "started", label: "Started", color: "#9E5CF7" },
  { id: "ongoing", label: "In progress", color: "#0366d6" },
  { id: "blocked", label: "Blocked", color: "#ed2651" },
  { id: "done", label: "Done", color: "#3ad984" },
  { id: "abandoned", label: "Dropped", color: "#a2b2c3" },
];

/** Kinds of task fields; labels are English source text, shown with t(). */
export const FIELD_TYPE_LABELS: Record<import("./types").FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  money: "Amount (€)",
  date: "Date",
  url: "Link",
  email: "E-mail",
  phone: "Phone",
  select: "Choice list",
  multiselect: "Multiple choices",
  checkbox: "Checkbox",
  user: "Person",
  rncp: "RNCP / RS qualification",
  docs: "Outline documents",
  files: "Files",
};

/** Moves an item of a list one step up (-1) or down (+1). */
export function moved<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Tasks still to be dealt with, i.e. neither done nor abandoned. */
export const openTaskCount = (counts: Partial<Record<Status, number>>) =>
  Object.entries(counts).reduce((n, [s, c]) => (s === "done" || s === "abandoned" ? n : n + (c ?? 0)), 0);

export const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<Status, (typeof STATUSES)[number]>;

import type { IconName } from "../components/Icon.svelte";

/** Icons offered for pipes (an emoji can be used instead). */
export const PIPE_ICONS: IconName[] = [
  "pipe", "star", "flag", "check", "clipboard", "calendar", "doc", "book", "graduation", "users", "user", "briefcase",
  "target", "megaphone", "mail", "phone", "comment", "euro", "chart", "shield", "bulb", "heart", "bolt", "folder",
  "inbox", "send", "globe", "home", "search", "settings",
];

// Outline brand colours.
export const PALETTE = ["#FF5C80", "#FF4DFA", "#9E5CF7", "#3633FF", "#2BC2FF", "#2930FF", "#3ad984", "#F5BE31", "#f08a24", "#0366d6"];

export function colorFor(seed = ""): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name = "?"): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Date formats of the current language (rebuilt when it changes).
const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(kind: "day" | "year" | "time"): Intl.DateTimeFormat {
  const key = `${intlLocale()}:${kind}`;
  let f = formats.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
    if (kind !== "day") opts.year = "numeric";
    if (kind === "time") Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
    formats.set(key, (f = new Intl.DateTimeFormat(intlLocale(), opts)));
  }
  return f;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return fmt(d.getFullYear() === new Date().getFullYear() ? "day" : "year").format(d);
}

export const formatDateTime = (iso: string) => fmt("time").format(new Date(iso));

/** A length of time: "45 min", "5 h 20", "3 d 4 h". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return t("{n} min", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? t("{h} h {m}", { h, m: String(min % 60).padStart(2, "0") }) : t("{h} h", { h });
  return h % 24 ? t("{d} d {h} h", { d: Math.floor(h / 24), h: h % 24 }) : t("{d} d", { d: Math.floor(h / 24) });
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t("just now");
  if (diff < 3600) return t("{n} min ago", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("{n} h ago", { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 7) return t("{n} d ago", { n: Math.floor(diff / 86400) });
  return formatDate(iso);
}

export const localDay = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function dueState(dueDate: string | null, status: Status): "" | "overdue" | "soon" {
  if (!dueDate || status === "done" || status === "abandoned") return "";
  if (dueDate < localDay()) return "overdue";
  return dueDate <= localDay(2) ? "soon" : "";
}
