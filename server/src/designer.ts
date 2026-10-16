/** Validation of the pipe and task types made with the designer. */
import { bad } from "./errors.js";
import {
  FIELD_TYPES, STATUSES, allTaskTypes, usableBy,
  type Column, type Field, type FieldType, type PipeType, type Status, type TaskType,
} from "./pipeTypes.js";

type Definition<T> = Omit<T, "id" | "custom" | "createdBy" | "updatedAt">;

const visibility = (v: unknown) => (v === "public" ? "public" : "private");

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9_]{1,40}$/;

function str(v: unknown, label: string, { required = false, max = 200 } = {}): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw bad(`${label} requis`);
  if (s.length > max) throw bad(`${label} trop long (${max} caractères au plus)`);
  return s;
}

function list(v: unknown, label: string, max: number): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${label} invalide`);
  if (v.length > max) throw bad(`${label} : ${max} au plus`);
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
    if (typeof it.id !== "string" || !ID.test(it.id)) throw bad(`${what} « ${it.label} » : identifiant invalide`);
    if (taken.has(it.id)) throw bad(`${what} en double : ${it.id}`);
    taken.add(it.id);
  }
  return items.map((it) => ({ ...it, id: typeof it.id === "string" && it.id ? it.id : slug(it.label, taken) }));
}

/** `previous`: the type being edited, whose task types stay allowed even if they became private. */
export function validatePipeType(input: unknown, userId: string, previous?: PipeType): Definition<PipeType> {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const label = str(b.label, "Nom", { required: true, max: 60 });
  const color = str(b.color, "Couleur") || "#2BC2FF";
  if (!HEX.test(color)) throw bad("Couleur invalide");

  const rawColumns = list(b.columns, "Colonnes", 15).map((c, i) => {
    const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const status = o.status as Status;
    if (!STATUSES.includes(status)) throw bad(`Colonne ${i + 1} : état invalide`);
    const color = str(o.color, "Couleur") || "#66778F";
    if (!HEX.test(color)) throw bad(`Colonne ${i + 1} : couleur invalide`);
    return { id: o.id, label: str(o.label, `Colonne ${i + 1} : nom`, { required: true, max: 40 }), status, color };
  });
  if (rawColumns.length < 2) throw bad("Il faut au moins deux colonnes");
  if (!rawColumns.some((c) => c.status === "done")) throw bad("Il faut au moins une colonne « terminé »");
  const columns: Column[] = withIds(rawColumns, "Colonne");

  const known = new Set(allTaskTypes().filter((t) => usableBy(t, userId) || previous?.taskTypes.includes(t.id)).map((t) => t.id));
  const taskTypes = [...new Set(list(b.taskTypes, "Types de tâches", 40).map(String))].filter((id) => id !== "task");
  for (const id of taskTypes) if (!known.has(id)) throw bad(`Type de tâche inconnu : ${id}`);

  const teamOnly = b.teamOnly === true;
  return {
    label,
    group: str(b.group, "Catégorie", { max: 40 }) || "Modèles personnalisés",
    visibility: visibility(b.visibility),
    description: str(b.description, "Description", { max: 500 }),
    color,
    icon: str(b.icon, "Icône", { max: 40 }) || "pipe",
    columns,
    taskTypes,
    // Reserved to a team implies confidential.
    confidential: teamOnly || b.confidential === true,
    teamOnly,
    templates: list(b.templates, "Tâches de départ", 50).map((t, i) => str(t, `Tâche de départ ${i + 1}`, { max: 300 })).filter(Boolean),
  };
}

export function validateTaskType(input: unknown, previous?: TaskType): Definition<TaskType> {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawFields = list(b.fields, "Champs", 40).map((x, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const label = str(o.label, `Champ ${i + 1} : nom`, { required: true, max: 80 });
    const type = o.type as FieldType;
    if (!FIELD_TYPES.includes(type)) throw bad(`Champ « ${label} » : type invalide`);
    const field: Omit<Field, "id"> & { id?: unknown } = { id: o.id, label, type };
    if (type === "select" || type === "multiselect") {
      const options = [...new Set(list(o.options, `Champ « ${label} » : choix`, 50).map((v) => str(v, "Choix", { max: 100 })).filter(Boolean))];
      if (!options.length) throw bad(`Champ « ${label} » : ajoutez au moins un choix`);
      field.options = options;
    }
    const hint = str(o.hint, `Champ « ${label} » : aide`, { max: 300 });
    if (hint) field.hint = hint;
    return field as Field & { id?: unknown };
  });
  const fields: Field[] = withIds(rawFields, "Champ");
  // The values already saved must stay readable: an existing field keeps its type.
  for (const f of fields) {
    const before = previous?.fields.find((p) => p.id === f.id);
    if (before && before.type !== f.type) {
      throw bad(`Champ « ${f.label} » : son type ne peut plus changer (des tâches l'utilisent peut-être). Créez un nouveau champ.`);
    }
  }
  return {
    label: str(b.label, "Nom", { required: true, max: 60 }),
    group: str(b.group, "Catégorie", { max: 40 }) || "Modèles personnalisés",
    visibility: visibility(b.visibility),
    icon: str(b.icon, "Icône", { max: 40 }) || "check",
    description: str(b.description, "Description", { max: 500 }),
    fields,
  };
}
