import type { Status } from "./types";

export const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "#66778F" },
  { id: "ready", label: "Prêt à démarrer", color: "#2BC2FF" },
  { id: "started", label: "Démarré", color: "#9E5CF7" },
  { id: "ongoing", label: "En cours", color: "#0366d6" },
  { id: "blocked", label: "Bloqué", color: "#ed2651" },
  { id: "done", label: "Terminé", color: "#3ad984" },
  { id: "abandoned", label: "Abandonné", color: "#a2b2c3" },
];

export const FIELD_TYPE_LABELS: Record<import("./types").FieldType, string> = {
  text: "Texte court",
  textarea: "Texte long",
  number: "Nombre",
  money: "Montant (€)",
  date: "Date",
  url: "Lien",
  email: "E-mail",
  phone: "Téléphone",
  select: "Liste de choix",
  multiselect: "Choix multiples",
  checkbox: "Case à cocher",
  user: "Personne",
  rncp: "Titre RNCP / RS",
  docs: "Documents Outline",
  files: "Fichiers",
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

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const dateFmtYear = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateFmtYear.format(d);
}

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)} j`;
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
