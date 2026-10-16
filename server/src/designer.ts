/** Validation of the pipe and task types made with the designer. */
import { bad } from "./errors.js";
import {
  FIELD_TYPES, STATUSES, allTaskTypes, usableBy,
  type Column, type Field, type FieldType, type PipeType, type Status, type TaskType,
} from "./pipeTypes.js";

type Definition<T> = Omit<T, "id" | "custom" | "createdBy" | "updatedAt">;

/** Default category of the types made with the designer (translated on display). */
export const CUSTOM_GROUP = "Custom models";

const visibility = (v: unknown) => (v === "public" ? "public" : "private");

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9_]{1,40}$/;

function str(v: unknown, label: string, { required = false, max = 200 } = {}): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw bad("{label} is required", { label });
  if (s.length > max) throw bad("{label} is too long ({max} characters at most)", { label, max });
  return s;
}

function list(v: unknown, label: string, max: number): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad("{label} is invalid", { label });
  if (v.length > max) throw bad("{label}: {max} at most", { label, max });
  return v;
}

/** An id readable in the data, made from a label, unique among `taken`. */
function slug(label: string, taken: Set<string>): string {
  const base =
    label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "x";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

/** Keeps the given ids of existing items, gives the others one made from their label. */
function withIds<T extends { id?: unknown; label: string }>(items: T[], what: string): (T & { id: string })[] {
  const taken = new Set<string>();
  for (const it of items) {
    if (it.id === undefined || it.id === null || it.id === "") continue;
    if (typeof it.id !== "string" || !ID.test(it.id)) throw bad("{what} “{name}”: invalid id", { what, name: it.label });
    if (taken.has(it.id)) throw bad("Duplicate {what}: {id}", { what, id: it.id });
    taken.add(it.id);
  }
  return items.map((it) => ({ ...it, id: typeof it.id === "string" && it.id ? it.id : slug(it.label, taken) }));
}

/** `previous`: the type being edited, whose task types stay allowed even if they became private. */
export function validatePipeType(input: unknown, userId: string, previous?: PipeType): Definition<PipeType> {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const label = str(b.label, "Name", { required: true, max: 60 });
  const color = str(b.color, "Colour") || "#2BC2FF";
  if (!HEX.test(color)) throw bad("Invalid colour");

  const rawColumns = list(b.columns, "Columns", 15).map((c, i) => {
    const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const status = o.status as Status;
    if (!STATUSES.includes(status)) throw bad("Column {n}: invalid state", { n: i + 1 });
    const color = str(o.color, "Colour") || "#66778F";
    if (!HEX.test(color)) throw bad("Column {n}: invalid colour", { n: i + 1 });
    return { id: o.id, label: str(o.label, "Column name", { required: true, max: 40 }), status, color };
  });
  if (rawColumns.length < 2) throw bad("At least two columns are needed");
  if (!rawColumns.some((c) => c.status === "done")) throw bad("At least one “done” column is needed");
  const columns: Column[] = withIds(rawColumns, "column");

  const known = new Set(allTaskTypes().filter((t) => usableBy(t, userId) || previous?.taskTypes.includes(t.id)).map((t) => t.id));
  const taskTypes = [...new Set(list(b.taskTypes, "Task types", 40).map(String))].filter((id) => id !== "task");
  for (const id of taskTypes) if (!known.has(id)) throw bad("Unknown task type: {id}", { id });

  const teamOnly = b.teamOnly === true;
  return {
    label,
    group: str(b.group, "Category", { max: 40 }) || CUSTOM_GROUP,
    visibility: visibility(b.visibility),
    description: str(b.description, "Description", { max: 500 }),
    color,
    icon: str(b.icon, "Icon", { max: 40 }) || "pipe",
    columns,
    taskTypes,
    // Reserved to a team implies confidential.
    confidential: teamOnly || b.confidential === true,
    teamOnly,
    templates: list(b.templates, "Starter tasks", 50).map((t) => str(t, "Starter task", { max: 300 })).filter(Boolean),
  };
}

export function validateTaskType(input: unknown, previous?: TaskType): Definition<TaskType> {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawFields = list(b.fields, "Fields", 40).map((x, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const label = str(o.label, "Field name", { required: true, max: 80 });
    const type = o.type as FieldType;
    if (!FIELD_TYPES.includes(type)) throw bad("Field “{name}”: invalid type", { name: label });
    const field: Omit<Field, "id"> & { id?: unknown } = { id: o.id, label, type };
    if (type === "select" || type === "multiselect") {
      const options = [...new Set(list(o.options, "Choices", 50).map((v) => str(v, "Choice", { max: 100 })).filter(Boolean))];
      if (!options.length) throw bad("Field “{name}”: add at least one choice", { name: label });
      field.options = options;
    }
    const hint = str(o.hint, "Help", { max: 300 });
    if (hint) field.hint = hint;
    return field as Field & { id?: unknown };
  });
  const fields: Field[] = withIds(rawFields, "field");
  // The values already saved must stay readable: an existing field keeps its type.
  for (const f of fields) {
    const before = previous?.fields.find((p) => p.id === f.id);
    if (before && before.type !== f.type) {
      throw bad("Field “{name}”: its type can no longer change (tasks may use it). Create a new field instead.", { name: f.label });
    }
  }
  return {
    label: str(b.label, "Name", { required: true, max: 60 }),
    group: str(b.group, "Category", { max: 40 }) || CUSTOM_GROUP,
    visibility: visibility(b.visibility),
    icon: str(b.icon, "Icon", { max: 40 }) || "check",
    description: str(b.description, "Description", { max: 500 }),
    fields,
  };
}
