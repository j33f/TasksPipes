import { bad } from "./errors.js";
import { absoluteOutlineUrl } from "./outline.js";
import type { Field, TaskType } from "./pipeTypes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown, field: Field, max: number) => {
  if (typeof v !== "string" && typeof v !== "number") throw bad("{field}: invalid value", { field: field.label });
  const s = String(v).trim();
  if (s.length > max) throw bad("{field}: too long", { field: field.label });
  return s || null;
};

/** Validates and normalises one field value; null clears it. Files are handled separately. */
export function cleanFieldValue(field: Field, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  switch (field.type) {
    case "text":
    case "email":
    case "phone":
      return str(v, field, 500);
    case "textarea":
      return str(v, field, 20_000);
    case "url": {
      const s = str(v, field, 2000);
      return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s;
    }
    case "number":
    case "money": {
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n)) throw bad("{field}: a number is expected", { field: field.label });
      return n;
    }
    case "date":
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad("{field}: invalid date", { field: field.label });
      return v;
    case "select":
      if (!field.options?.includes(v as string)) throw bad("{field}: invalid choice", { field: field.label });
      return v;
    case "multiselect": {
      if (!Array.isArray(v) || v.some((x) => !field.options?.includes(x))) throw bad("{field}: invalid choice", { field: field.label });
      return v.length ? field.options!.filter((o) => v.includes(o)) : null;
    }
    case "checkbox":
      return v === true ? true : null;
    case "user":
      if (typeof v !== "string" || !UUID.test(v)) throw bad("{field}: invalid person", { field: field.label });
      return v;
    case "rncp": {
      // { code: "RNCP37873" | "RS5487", title }
      const o = (typeof v === "object" ? v : { code: v }) as { code?: unknown; title?: unknown };
      const raw = String(o.code ?? "").trim();
      const m = raw.match(/^(RNCP|RS)\s*-?\s*(\d{1,6})$/i);
      if (raw && !m) throw bad("{field}: expected a code like RNCP12345 or RS1234", { field: field.label });
      const title = o.title ? String(o.title).trim().slice(0, 500) : "";
      if (!m && !title) return null;
      return { code: m ? `${m[1].toUpperCase()}${m[2]}` : null, title: title || null };
    }
    case "docs": {
      if (!Array.isArray(v)) throw bad("{field}: invalid value", { field: field.label });
      const docs = v.slice(0, 30).map((d) => {
        const doc = d as { id?: unknown; title?: unknown; url?: unknown };
        if (typeof doc.id !== "string" || !doc.id) throw bad("{field}: invalid document", { field: field.label });
        return { id: doc.id.slice(0, 200), title: String(doc.title || "Untitled").slice(0, 500), url: absoluteOutlineUrl(String(doc.url || "")) };
      });
      return docs.length ? docs : null;
    }
    case "files":
      throw bad("{field}: files are uploaded separately", { field: field.label });
  }
}

/** Validates a partial set of field values for a task type; returns them with labels of the fields touched. */
export function cleanFields(type: TaskType, input: unknown): { values: Record<string, unknown>; labels: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("Invalid fields");
  const values: Record<string, unknown> = {};
  const labels: string[] = [];
  for (const [id, v] of Object.entries(input)) {
    const field = type.fields.find((x) => x.id === id);
    if (!field) throw bad("Unknown field for “{type}”: {id}", { type: type.label, id });
    values[id] = cleanFieldValue(field, v);
    labels.push(field.label);
  }
  return { values, labels };
}
