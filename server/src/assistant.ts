/**
 * The AI assistant on a task (lot 2 of the assistant): it proposes a better title, description and field values,
 * from the task, its sub-tasks and its comments, following simple rules (general ones, then those of the pipe's
 * type and of the task's type, which the models can change). Nothing is saved here: the person sees the proposal
 * next to what is there and applies what they keep. Confidential tasks never reach the AI.
 */
import { aiConfig, complete } from "./ai.js";
import { isConfidential } from "./access.js";
import { query, type Row } from "./db.js";
import { bad, forbidden } from "./errors.js";
import { cleanFieldValue } from "./fields.js";
import { pipeTypeById, taskTypeById, type Field } from "./pipeTypes.js";

/** Field types the assistant may fill (people, files and documents stay with people). */
const FILLABLE = new Set(["text", "textarea", "number", "money", "date", "url", "email", "phone", "select", "multiselect", "checkbox"]);

export interface Proposal {
  title?: string;
  description?: string;
  fields?: Record<string, unknown>;
  /** What the assistant did, or what it could not do, in a sentence or two. */
  notes?: string;
}

const RULES = `You help people keep their tasks clear and complete, in a task manager.
Improve the task given as JSON:
- title: short and clear (at most 120 characters); keep it when it is already good;
- description: complete and well organised Markdown, keeping every fact, link and decision already there (the
  description and the comments); never invent facts, names, dates or figures: when something is missing, say it in notes;
- fields: fill or improve the fields listed, only with what the task and its comments say; for a "select" field use one of
  its options exactly; for "multiselect" a list of them; dates as YYYY-MM-DD; numbers as numbers; leave out a field you cannot fill.
Write in the language of the task (the one of its title and description).
Answer with one JSON object and nothing else:
{"title": string or null, "description": string or null, "fields": {"<field id>": value}, "notes": string}
null (or leaving a field out) keeps what is there.`;

/** What the AI is told of a task. */
async function taskFacts(t: Row, fields: Field[]) {
  const [comments, items] = await Promise.all([
    query(
      `SELECT e.comment, e.created_at, u.name FROM task_events e JOIN users u ON u.id = e.actor_id
       WHERE e.task_id = $1 AND e.type = 'comment' AND e.comment IS NOT NULL ORDER BY e.id DESC LIMIT 40`,
      [t.id]
    ),
    query(`SELECT text, done FROM task_items WHERE task_id = $1 ORDER BY position, created_at LIMIT 100`, [t.id]),
  ]);
  const values = (t.fields ?? {}) as Record<string, unknown>;
  return {
    title: t.title,
    description: t.description ?? "",
    type: taskTypeById(t.task_type)?.label ?? t.task_type,
    pipe: t.pipe_name ?? null,
    fields: fields.map((f) => ({ id: f.id, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}), ...(f.hint ? { hint: f.hint } : {}), value: values[f.id] ?? null })),
    subtasks: items.rows.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`),
    // Oldest first, as they were written.
    comments: comments.rows.reverse().map((c) => ({ by: c.name, at: c.created_at, text: String(c.comment).slice(0, 4000) })),
  };
}

/** The first JSON object of an answer (models sometimes wrap it in a code block or a sentence). */
export function parseAnswer(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw bad("The AI's answer could not be read");
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch { /* below */ }
  throw bad("The AI's answer could not be read");
}

/** The parts of an answer that are valid and differ from the task; what is wrong is dropped. */
export function cleanProposal(answer: Record<string, unknown>, t: Row, fields: Field[]): Proposal {
  const out: Proposal = {};
  const title = typeof answer.title === "string" ? answer.title.trim().slice(0, 300) : "";
  if (title && title !== t.title) out.title = title;
  const description = typeof answer.description === "string" ? answer.description.trim().slice(0, 100_000) : "";
  if (description && description !== (t.description ?? "").trim()) out.description = description;
  const current = (t.fields ?? {}) as Record<string, unknown>;
  const given = answer.fields && typeof answer.fields === "object" && !Array.isArray(answer.fields) ? (answer.fields as Record<string, unknown>) : {};
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f.id in given) || given[f.id] === null || given[f.id] === "") continue;
    try {
      const v = cleanFieldValue(f, given[f.id]);
      if (v !== null && JSON.stringify(v) !== JSON.stringify(current[f.id] ?? null)) values[f.id] = v;
    } catch { /* a value the field refuses: left out */ }
  }
  if (Object.keys(values).length) out.fields = values;
  if (typeof answer.notes === "string" && answer.notes.trim()) out.notes = answer.notes.trim().slice(0, 1000);
  return out;
}

/** A proposal for a task the person may edit. */
export async function assistTask(t: Row): Promise<Proposal> {
  const cfg = aiConfig();
  if (!cfg?.model) throw bad("No AI assistant is set up on this instance");
  if (isConfidential(t)) throw forbidden("The AI assistant never sees confidential tasks");
  const type = taskTypeById(t.task_type);
  const fields = (type?.fields ?? []).filter((f) => FILLABLE.has(f.type));
  const rules = [pipeTypeById(t.pipe_kind)?.assistant, type?.assistant].filter(Boolean);
  const system = rules.length ? `${RULES}\n\nRules of this kind of task:\n- ${rules.join("\n- ")}` : RULES;
  const facts = await taskFacts(t, fields);
  const text = await complete(cfg, system, [{ role: "user", content: JSON.stringify(facts) }], { maxTokens: 8000 });
  return cleanProposal(parseAnswer(text), t, fields);
}
