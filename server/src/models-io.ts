/**
 * Export and import of models (pipe and task types) as YAML files.
 *
 * A file lists task types and pipe types. A pipe type refers to the task types it offers by id: the id of a
 * task type of the same file, or of a type the importer can use (built-in, public, or their own). Exporting a
 * pipe type brings along the custom task types it offers, so that the file stands on its own. Imported types
 * are new private models of the importer, whatever their visibility was.
 */
import { parse, stringify } from "yaml";
import { bad } from "./errors.js";
import { localizePipeType, localizeTaskType, type Locale } from "./i18n.js";
import { allPipeTypes, allTaskTypes, usableBy, type PipeType, type TaskType } from "./pipeTypes.js";
import { validatePipeType, validateTaskType } from "./designer.js";
import type { Queryable } from "./db.js";

/** Version of the file format, written in each file. */
export const FORMAT = 1;
const MAX_TYPES = 100;

interface ModelFile {
  taskspipes: number;
  taskTypes?: unknown[];
  pipeTypes?: unknown[];
}

const pipeOut = (p: PipeType) => ({
  id: p.id,
  label: p.label,
  group: p.group,
  description: p.description || undefined,
  icon: p.icon,
  color: p.color,
  confidential: p.confidential || undefined,
  teamOnly: p.teamOnly || undefined,
  columns: p.columns.map(({ id, label, status, color }) => ({ id, label, status, color })),
  taskTypes: p.taskTypes.length ? p.taskTypes : undefined,
  templates: p.templates.length ? p.templates : undefined,
});

// Choices are written as they read: in the importer's file they become the stored values of a new type.
const taskOut = (t: ReturnType<typeof localizeTaskType>) => ({
  id: t.id,
  label: t.label,
  group: t.group || undefined,
  description: t.description || undefined,
  icon: t.icon,
  fields: t.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    ...(f.options ? { options: f.optionLabels ?? f.options } : {}),
    ...(f.hint ? { hint: f.hint } : {}),
  })),
});

/**
 * YAML of the given types, in the language of the reader. Custom task types offered by the exported pipe
 * types are added; built-in ones are referred to by id.
 */
export function exportModels(pipeIds: string[], taskIds: string[], userId: string, lang: Locale): string {
  const pipes = allPipeTypes().filter((p) => pipeIds.includes(p.id) && usableBy(p, userId));
  const wanted = new Set(taskIds);
  for (const p of pipes) for (const id of p.taskTypes) wanted.add(id);
  const tasks = allTaskTypes().filter((t) => wanted.has(t.id) && (taskIds.includes(t.id) || t.custom) && usableBy(t, userId));
  if (!pipes.length && !tasks.length) throw bad("Nothing to export");
  const file: ModelFile = {
    taskspipes: FORMAT,
    ...(tasks.length ? { taskTypes: tasks.map((t) => taskOut(localizeTaskType(lang, t))) } : {}),
    ...(pipes.length ? { pipeTypes: pipes.map((p) => pipeOut(localizePipeType(lang, p))) } : {}),
  };
  return `# TasksPipes models — import them from Models › Import\n${stringify(file, { lineWidth: 0 })}`;
}

/** Reads a model file; refuses anything that is not one. */
export function parseModels(text: string): { taskTypes: Record<string, unknown>[]; pipeTypes: Record<string, unknown>[] } {
  let data: unknown;
  try {
    // A few aliases at most: no "billion laughs" expansion.
    data = parse(text, { maxAliasCount: 20 });
  } catch (e) {
    throw bad("This file is not valid YAML: {error}", { error: String((e as Error).message).split("\n")[0] });
  }
  const file = data as ModelFile | null;
  if (!file || typeof file !== "object" || Array.isArray(file) || file.taskspipes === undefined) {
    throw bad("This file is not a TasksPipes model file");
  }
  if (file.taskspipes !== FORMAT) throw bad("Unsupported model file version: {version}", { version: String(file.taskspipes) });
  const list = (v: unknown) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => !x || typeof x !== "object" || Array.isArray(x))) throw bad("This file is not a TasksPipes model file");
    return v as Record<string, unknown>[];
  };
  const taskTypes = list(file.taskTypes);
  const pipeTypes = list(file.pipeTypes);
  if (!taskTypes.length && !pipeTypes.length) throw bad("This file holds no model");
  if (taskTypes.length + pipeTypes.length > MAX_TYPES) throw bad("{n} models at most per file", { n: MAX_TYPES });
  return { taskTypes, pipeTypes };
}

/**
 * Creates the models of a file as private types of `userId`, all or nothing (`db` is a transaction).
 * Returns the created types, with their new ids.
 */
export async function importModels(db: Queryable, text: string, userId: string) {
  const { taskTypes, pipeTypes } = parseModels(text);
  // Ids of the file → new ids, so that pipe types can offer the task types of the same file.
  const ids = new Map<string, string>();
  const created: { kind: "pipe" | "task"; id: string; label: string }[] = [];

  for (const raw of taskTypes) {
    const def = validateTaskType({ ...raw, visibility: "private" });
    const { rows } = await db.query(
      `INSERT INTO custom_types (id, kind, definition, created_by) VALUES (gen_uuidv7()::text, 'task', $1, $2) RETURNING id`,
      [JSON.stringify(def), userId]
    );
    if (typeof raw.id === "string" && raw.id) ids.set(raw.id, rows[0].id);
    created.push({ kind: "task", id: rows[0].id, label: def.label });
  }

  const fresh = [...ids.values()];
  for (const raw of pipeTypes) {
    const offered = Array.isArray(raw.taskTypes) ? raw.taskTypes.map((id) => (typeof id === "string" ? (ids.get(id) ?? id) : id)) : raw.taskTypes;
    const def = validatePipeType({ ...raw, taskTypes: offered, visibility: "private" }, userId, undefined, fresh);
    const { rows } = await db.query(
      `INSERT INTO custom_types (id, kind, definition, created_by) VALUES (gen_uuidv7()::text, 'pipe', $1, $2) RETURNING id`,
      [JSON.stringify(def), userId]
    );
    created.push({ kind: "pipe", id: rows[0].id, label: def.label });
  }
  return created;
}
