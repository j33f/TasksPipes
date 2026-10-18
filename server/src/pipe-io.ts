/**
 * Tasks in and out of a pipe: export as CSV or JSON (the task types' fields included), import from a CSV file —
 * its columns matched to task properties — or from a Trello board exported as JSON. An import is checked line by
 * line first; it is written only when every line is valid, in one transaction (see the routes).
 */
import { HttpError } from "./errors.js";
import { cleanFieldValue } from "./fields.js";
import { LOCALES, localize, tr, type Locale } from "./i18n.js";
import { parseCsv, toCsv, type Separator } from "./csv.js";
import { pipeTypeById, resolveStage, taskTypeById, type Column, type Field, type Status, type TaskType } from "./pipeTypes.js";

export const MAX_IMPORT_ROWS = 2000;
const MAX_ITEMS = 100;
/** Fields that only take uploads or documents picked in Outline: neither exported as text nor imported. */
const NOT_TEXT: Field["type"][] = ["files", "docs"];

/** Someone who may own an imported task: a member of the pipe's space. */
export interface Person {
  id: string;
  name: string;
  email: string | null;
}

/** What the import makes of one line. */
export interface ImportTask {
  line: number;
  title: string;
  description: string;
  stage: string;
  status: Status;
  assigneeId: string | null;
  dueDate: string | null;
  taskType: string;
  fields: Record<string, unknown>;
  items: { text: string; done: boolean }[];
  /** Comments to add to the history (Trello), already prefixed with their author and date. */
  comments: string[];
}

export interface ImportError {
  line: number;
  message: string;
}

/** Lower case, without accents or surrounding spaces: how headers, columns, options and names are compared. */
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

const pipeKind = (kind: string) => pipeTypeById(kind) ?? pipeTypeById("general")!;
const columnsOf = (kind: string) => pipeKind(kind).columns;
/** The board columns of a pipe type, labelled in `lang`. */
export const columnsFor = (kind: string, lang: Locale) => columnsOf(kind).map((c) => ({ id: c.id, label: localize(lang, c.label) }));

/** Task types the pipe offers: the plain task, then those of its type (as in the app). */
export const taskTypesOf = (kind: string) =>
  ["task", ...pipeKind(kind).taskTypes].map(taskTypeById).filter((t): t is TaskType => Boolean(t));

// ---------------------------------------------------------------------------
// Export

export interface ExportedTask {
  number: number;
  title: string;
  description: string;
  status: Status;
  stage: string | null;
  task_type: string;
  fields: Record<string, unknown>;
  due_date: string | null;
  owner_name: string | null;
  author_name: string;
  created_at: Date | string;
  updated_at: Date | string;
  items: { text: string; done: boolean }[];
  priority?: number | null;
  labels?: string[];
  estimate_minutes?: number | null;
  logged_minutes?: number | string;
}

/** Minutes as hours, "1.5" (spreadsheets add them up). */
const hours = (m: number | string | null | undefined) => (m ? String(Math.round((Number(m) / 60) * 100) / 100) : "");

/** Priority names, from 1 (urgent) to 4 (low). */
export const PRIORITY_NAMES = ["Urgent", "High", "Medium", "Low"];
const priorityText = (lang: Locale, p: number | null | undefined) => (p ? tr(lang, PRIORITY_NAMES[p - 1]) : "");

/** A field value as text: choices joined, people by name, a training by code and title. */
export function fieldText(field: Field, v: unknown, names: Map<string, string>): string {
  if (v === null || v === undefined) return "";
  switch (field.type) {
    case "multiselect":
      return (v as string[]).join("; ");
    case "checkbox":
      return v ? "x" : "";
    case "user":
      return names.get(String(v)) ?? "";
    case "rncp": {
      const r = v as { code?: string | null; title?: string | null };
      return [r.code, r.title].filter(Boolean).join(" — ");
    }
    default:
      return String(v);
  }
}

/** The fields of the pipe's task types, each once (two types may share a field id: the first label is kept). */
function exportFields(kind: string) {
  const seen = new Map<string, Field>();
  for (const t of taskTypesOf(kind)) for (const f of t.fields) if (!NOT_TEXT.includes(f.type) && !seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
}

/** Header names of the export, which the import recognises. */
const headers = (lang: Locale) => ({
  key: tr(lang, "Key"),
  title: tr(lang, "Title"),
  description: tr(lang, "Description"),
  column: tr(lang, "Column"),
  owner: tr(lang, "Owner"),
  dueDate: tr(lang, "Due date"),
  taskType: tr(lang, "Task type"),
  items: tr(lang, "Sub-tasks"),
  priority: tr(lang, "Priority"),
  labels: tr(lang, "Labels"),
  estimate: tr(lang, "Estimate (hours)"),
  logged: tr(lang, "Logged time (hours)"),
  author: tr(lang, "Author"),
  created: tr(lang, "Created"),
  updated: tr(lang, "Updated"),
});

const iso = (d: Date | string) => new Date(d).toISOString();
const itemsText = (items: { text: string; done: boolean }[]) => items.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`).join("\n");

export function exportCsv(kind: string, tasks: ExportedTask[], lang: Locale, names: Map<string, string>, key: (n: number) => string, sep: Separator) {
  const h = headers(lang);
  const fields = exportFields(kind);
  const label = (s: string) => localize(lang, s);
  const rows: unknown[][] = [[
    h.key, h.title, h.description, h.column, h.owner, h.dueDate, h.taskType, h.items,
    ...fields.map((f) => label(f.label)), h.priority, h.labels, h.estimate, h.logged, h.author, h.created, h.updated,
  ]];
  for (const t of tasks) {
    const type = taskTypeById(t.task_type);
    rows.push([
      key(t.number), t.title, t.description, label(resolveStage(kind, t.stage, t.status).label), t.owner_name ?? "", t.due_date ?? "",
      type ? label(type.label) : t.task_type, itemsText(t.items),
      ...fields.map((f) => (type?.fields.some((x) => x.id === f.id) ? fieldText(f, t.fields[f.id], names) : "")),
      priorityText(lang, t.priority), (t.labels ?? []).join("; "), hours(t.estimate_minutes), hours(t.logged_minutes), t.author_name, iso(t.created_at), iso(t.updated_at),
    ]);
  }
  return toCsv(rows, sep);
}

export function exportJson(pipe: { name: string; kind: string }, tasks: ExportedTask[], lang: Locale, names: Map<string, string>, key: (n: number) => string) {
  const label = (s: string) => localize(lang, s);
  return {
    exportedAt: new Date().toISOString(),
    pipe: { name: pipe.name, type: pipe.kind },
    tasks: tasks.map((t) => {
      const type = taskTypeById(t.task_type);
      return {
        key: key(t.number),
        title: t.title,
        description: t.description,
        status: t.status,
        column: label(resolveStage(pipe.kind, t.stage, t.status).label),
        owner: t.owner_name,
        dueDate: t.due_date,
        taskType: { id: t.task_type, label: type ? label(type.label) : t.task_type },
        priority: t.priority ?? null,
        labels: t.labels ?? [],
        estimateMinutes: t.estimate_minutes ?? null,
        loggedMinutes: Number(t.logged_minutes ?? 0),
        // Field values as stored, with their labels.
        fields: (type?.fields ?? []).filter((f) => t.fields[f.id] !== undefined).map((f) => ({
          id: f.id, label: label(f.label), type: f.type, value: t.fields[f.id], text: fieldText(f, t.fields[f.id], names),
        })),
        subTasks: t.items,
        author: t.author_name,
        createdAt: iso(t.created_at),
        updatedAt: iso(t.updated_at),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Import

/** What a column of the file can hold. */
export type Target =
  | "ignore" | "title" | "description" | "column" | "owner" | "dueDate" | "taskType" | "items" | "comments" | `field:${string}`;

/** The targets offered for a pipe, with their labels in `lang`. */
export function targetsFor(kind: string, lang: Locale): { id: Target; label: string }[] {
  const h = headers(lang);
  const fields = exportFields(kind);
  return [
    { id: "ignore", label: tr(lang, "(ignore)") },
    { id: "title", label: h.title },
    { id: "description", label: h.description },
    { id: "column", label: h.column },
    { id: "owner", label: h.owner },
    { id: "dueDate", label: h.dueDate },
    { id: "taskType", label: h.taskType },
    { id: "items", label: h.items },
    ...fields.map((f) => ({ id: `field:${f.id}` as Target, label: localize(lang, f.label) })),
  ];
}

/** The target a header most likely names: a target label (in either language) or a usual synonym. */
export function suggestTarget(header: string, kind: string): Target {
  const h = norm(header);
  const synonyms: [Target, string[]][] = [
    ["title", ["title", "titre", "name", "nom", "card name", "summary", "task", "tache"]],
    ["description", ["description", "desc", "details", "notes"]],
    ["column", ["column", "colonne", "list", "liste", "status", "etat", "statut", "stage", "etape"]],
    ["owner", ["owner", "proprietaire", "assignee", "assigne", "assignee name", "responsable", "members", "membres"]],
    ["dueDate", ["due date", "due", "echeance", "date d'echeance", "deadline"]],
    ["taskType", ["task type", "type de tache", "type"]],
    ["items", ["sub-tasks", "sous-taches", "subtasks", "checklist", "checklists"]],
  ];
  for (const [target, words] of synonyms) if (words.includes(h)) return target;
  for (const f of exportFields(kind)) {
    if ([f.id, f.label, ...LOCALES.map((l) => localize(l, f.label))].map(norm).includes(h)) return `field:${f.id}`;
  }
  return "ignore";
}

/** A date written YYYY-MM-DD, or DD/MM/YYYY (also with dots or dashes), as YYYY-MM-DD; null if empty. */
export function parseDate(s: string): string | null | undefined {
  const v = s.trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  const ymd = m ? [m[1], m[2], m[3]] : (m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)) ? [m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0")] : null;
  if (!ymd) return undefined;
  const d = new Date(`${ymd.join("-")}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd.join("-") ? undefined : ymd.join("-");
}

/** Sub-tasks from lines (or "; "), "[x]" marking the done ones. */
export function parseItems(s: string) {
  return s.split(/\r?\n|;\s/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_ITEMS).map((l) => {
    const m = l.match(/^\[( |x|X)\]\s*(.*)$/);
    return { text: (m ? m[2] : l).slice(0, 500), done: Boolean(m && m[1] !== " ") };
  }).filter((i) => i.text);
}

const TRUE = ["x", "yes", "oui", "true", "vrai", "1"];

/** A cell for a field, turned into the value cleanFieldValue expects (choices and people matched loosely). */
function fieldInput(field: Field, cell: string, people: Person[]): unknown {
  const v = cell.trim();
  if (!v) return null;
  const option = (s: string) => field.options?.find((o) => norm(o) === norm(s)) ?? s;
  switch (field.type) {
    case "select":
      return option(v);
    case "multiselect":
      return v.split(/[;,]/).map((x) => x.trim()).filter(Boolean).map(option);
    case "checkbox":
      return TRUE.includes(norm(v)) ? true : null;
    case "user": {
      const p = people.find((x) => norm(x.name) === norm(v) || norm(x.email) === norm(v));
      if (!p) throw new HttpError(400, "Unknown person: {name}", { name: v });
      return p.id;
    }
    case "rncp": {
      const [code, ...title] = v.split(/\s+[—-]\s+/);
      return /^(RNCP|RS)\s*-?\s*\d+$/i.test(code) ? { code, title: title.join(" — ") } : { code: "", title: v };
    }
    default:
      return v;
  }
}

export interface ImportInput {
  /** The file's lines, the first one holding the headers. */
  rows: string[][];
  /** Target of each column, by index; missing ones are suggested from the headers. */
  mapping?: Record<string, Target>;
  /** Task type of lines that name none. */
  taskType?: string;
  /** Board column chosen for a value of the "column" cells (a Trello list, another tool's state…), by value. */
  columnValues?: Record<string, string>;
}

export interface ImportPlan {
  headers: string[];
  mapping: Target[];
  tasks: ImportTask[];
  errors: ImportError[];
  /** Values of the "column" cells that match no column of the pipe, and the column each goes to. */
  columnValues: { value: string; column: string }[];
}

/**
 * Checks every line of a file against the pipe: required title, known column, owner among the space's members,
 * valid date, a task type the pipe offers, field values as the form would take them. Lines are numbered as in
 * the file (the headers are line 1).
 */
export function planImport(kind: string, lang: Locale, input: ImportInput, people: Person[], personalHolder: string | null): ImportPlan {
  const [head = [], ...lines] = input.rows;
  const headers = head.map((h) => h.trim());
  const mapping = headers.map((h, i) => input.mapping?.[i] ?? suggestTarget(h, kind));
  const columns = columnsOf(kind);
  const types = taskTypesOf(kind);
  const errors: ImportError[] = [];
  const tasks: ImportTask[] = [];
  const unknownColumns = new Map<string, string>();
  const findColumn = (v: string): Column | undefined => {
    const n = norm(v);
    return columns.find((c) => [c.id, c.label, ...LOCALES.map((l) => localize(l, c.label)), c.status].map(norm).includes(n));
  };
  const defaultType = types.find((t) => t.id === input.taskType) ?? types[0];
  if (lines.length > MAX_IMPORT_ROWS) {
    errors.push({ line: MAX_IMPORT_ROWS + 2, message: tr(lang, "At most {n} lines can be imported at once", { n: MAX_IMPORT_ROWS }) });
  }
  if (!mapping.includes("title")) errors.push({ line: 1, message: tr(lang, "No column holds the title") });

  lines.slice(0, MAX_IMPORT_ROWS).forEach((cells, i) => {
    const line = i + 2;
    if (cells.every((c) => !c.trim())) return;
    const cell = (t: Target) => {
      const idx = mapping.indexOf(t);
      return idx < 0 ? "" : (cells[idx] ?? "");
    };
    const fail = (message: string, params?: Record<string, string | number>) => errors.push({ line, message: tr(lang, message, params) });
    try {
      const title = cell("title").trim();
      if (!title) return fail("{label} is required", { label: "Title" });
      if (title.length > 300) return fail("{label} is too long", { label: "Title" });

      const rawType = cell("taskType").trim();
      const type = rawType ? types.find((t) => [t.id, t.label, ...LOCALES.map((l) => localize(l, t.label))].map(norm).includes(norm(rawType))) : defaultType;
      if (!type) return fail("“{type}” is not a task type of this pipe", { type: rawType });

      const rawColumn = cell("column").trim();
      const chosen = rawColumn && input.columnValues?.[rawColumn];
      const column = rawColumn ? (chosen ? columns.find((c) => c.id === chosen) : findColumn(rawColumn)) : columns[0];
      if (!column) {
        unknownColumns.set(rawColumn, "");
        return fail("Unknown column “{column}”: choose where it goes", { column: rawColumn });
      }
      if (chosen) unknownColumns.set(rawColumn, column.id);

      const rawOwner = cell("owner").trim();
      let assigneeId: string | null = null;
      if (rawOwner) {
        const p = people.find((x) => norm(x.name) === norm(rawOwner) || norm(x.email) === norm(rawOwner));
        if (personalHolder) {
          // In a personal space, tasks belong to its holder: only their own name is accepted.
          if (p?.id !== personalHolder) return fail("A task in a personal space belongs to its holder: send it to someone instead.");
        } else if (!p) return fail("{name} is not a member of this space", { name: rawOwner });
        else assigneeId = p.id;
      }

      const dueDate = parseDate(cell("dueDate"));
      if (dueDate === undefined) return fail("Invalid due date: {date}", { date: cell("dueDate").trim() });

      const fields: Record<string, unknown> = {};
      mapping.forEach((t, idx) => {
        if (!t.startsWith("field:") || !(cells[idx] ?? "").trim()) return;
        const field = type.fields.find((f) => f.id === t.slice(6));
        if (!field) throw new HttpError(400, "“{field}” is not a field of “{type}”", { field: headers[idx], type: localize(lang, type.label) });
        const value = cleanFieldValue(field, fieldInput(field, cells[idx], people));
        if (value !== null) fields[field.id] = value;
      });

      tasks.push({
        line, title, description: cell("description").slice(0, 100_000), stage: column.id, status: column.status, assigneeId,
        dueDate, taskType: type.id, fields, items: parseItems(cell("items")),
        comments: cell("comments") ? cell("comments").split("\u0000").filter(Boolean) : [],
      });
    } catch (err) {
      if (err instanceof HttpError) fail(err.message, err.params);
      else throw err;
    }
  });
  return { headers, mapping, tasks, errors, columnValues: [...unknownColumns].map(([value, column]) => ({ value, column })) };
}

/** Reads a CSV file into lines of cells. */
export const csvRows = (text: string) => parseCsv(text);

interface TrelloBoard {
  lists?: { id: string; name: string; closed?: boolean }[];
  cards?: { id: string; name: string; desc?: string; idList: string; due?: string | null; closed?: boolean; idChecklists?: string[] }[];
  checklists?: { id: string; idCard: string; checkItems?: { name: string; state: string; pos?: number }[] }[];
  actions?: { type: string; date: string; data?: { text?: string; card?: { id: string } }; memberCreator?: { fullName?: string } }[];
}

/**
 * A Trello board exported as JSON, as lines of the same kind as a CSV file: open cards of open lists, their list as
 * the column, description, due date, checklists as sub-tasks, and comments (with their author and date).
 */
export function trelloRows(json: unknown, lang: Locale): string[][] {
  const b = json as TrelloBoard;
  if (!b || !Array.isArray(b.cards) || !Array.isArray(b.lists)) throw new HttpError(400, "This is not a Trello board exported as JSON");
  const lists = new Map(b.lists.filter((l) => !l.closed).map((l) => [l.id, l.name]));
  const checklists = new Map<string, { name: string; state: string; pos?: number }[]>();
  for (const c of b.checklists ?? []) checklists.set(c.idCard, [...(checklists.get(c.idCard) ?? []), ...(c.checkItems ?? [])]);
  const comments = new Map<string, string[]>();
  for (const a of [...(b.actions ?? [])].reverse()) {
    if (a.type !== "commentCard" || !a.data?.card?.id || !a.data.text) continue;
    const text = tr(lang, "{name} on Trello, {date}:", { name: a.memberCreator?.fullName ?? "?", date: a.date.slice(0, 10) }) + `\n\n${a.data.text}`;
    comments.set(a.data.card.id, [...(comments.get(a.data.card.id) ?? []), text]);
  }
  const rows: string[][] = [["title", "description", "column", "dueDate", "items", "comments"]];
  for (const c of b.cards) {
    if (c.closed || !lists.has(c.idList)) continue;
    const items = (checklists.get(c.id) ?? []).sort((x, y) => (x.pos ?? 0) - (y.pos ?? 0))
      .map((i) => `${i.state === "complete" ? "[x]" : "[ ]"} ${i.name}`).join("\n");
    rows.push([c.name, c.desc ?? "", lists.get(c.idList)!, c.due ? c.due.slice(0, 10) : "", items, (comments.get(c.id) ?? []).join("\u0000")]);
  }
  return rows;
}

/** The fixed mapping of the lines trelloRows makes. */
export const TRELLO_MAPPING: Record<string, Target> = { 0: "title", 1: "description", 2: "column", 3: "dueDate", 4: "items", 5: "comments" };
