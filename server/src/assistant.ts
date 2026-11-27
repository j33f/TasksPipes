/**
 * The AI assistant on a task (lot 2 of the assistant): it proposes a better title, description and field values,
 * from the task, its sub-tasks and its comments, following simple rules (general ones, then those of the pipe's
 * type and of the task's type, which the models can change). Nothing is saved here: the person sees the proposal
 * next to what is there and applies what they keep. Confidential tasks never reach the AI.
 */
import { aiConfig, complete, type AiMessage } from "./ai.js";
import { isConfidential } from "./access.js";
import { query, type Row } from "./db.js";
import { bad, forbidden } from "./errors.js";
import { cleanFieldValue } from "./fields.js";
import { pipeTypeById, taskTypeById, type Field } from "./pipeTypes.js";
import type { Locale } from "./i18n.js";
import { searchTasks } from "./search.js";

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

/** What the person said to the assistant: answers to its questions, and a discussion. */
export interface Exchange {
  answers?: { question: string; answer: string }[];
  discussion?: AiMessage[];
}

/** Answers and discussion, checked and capped (they come from the browser). */
export function cleanExchange(input: unknown): Exchange {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 20)
    .map((a) => ({ question: str(a?.question, 500), answer: str(a?.answer, 4000) }))
    .filter((a) => a.question && a.answer);
  const discussion = (Array.isArray(b.discussion) ? b.discussion : []).slice(-30)
    .map((m) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: str(m?.content, 4000) }) as AiMessage)
    .filter((m) => m.content);
  return { ...(answers.length ? { answers } : {}), ...(discussion.length ? { discussion } : {}) };
}

/** The AI, its rules for this task, the fields it may fill and what it is told of the task. */
async function context(t: Row) {
  const cfg = aiConfig();
  if (!cfg?.model) throw bad("No AI assistant is set up on this instance");
  if (isConfidential(t)) throw forbidden("The AI assistant never sees confidential tasks");
  const type = taskTypeById(t.task_type);
  const fields = (type?.fields ?? []).filter((f) => FILLABLE.has(f.type));
  const rules = [pipeTypeById(t.pipe_kind)?.assistant, type?.assistant].filter(Boolean);
  const kindRules = rules.length ? `\n\nRules of this kind of task:\n- ${rules.join("\n- ")}` : "";
  return { cfg, fields, kindRules, facts: await taskFacts(t, fields) };
}

/** A proposal for a task the person may edit, using what they answered or discussed, if anything. */
export async function assistTask(t: Row, exchange: Exchange = {}): Promise<Proposal> {
  const { cfg, fields, kindRules, facts } = await context(t);
  const told = exchange.answers || exchange.discussion
    ? `\n\nThe person also told you this (it is as reliable as the task itself):\n${JSON.stringify(exchange)}`
    : "";
  const text = await complete(cfg, RULES + kindRules, [{ role: "user", content: JSON.stringify(facts) + told }], { maxTokens: 8000 });
  return cleanProposal(parseAnswer(text), t, fields);
}

const QUESTIONS = `You help people keep their tasks clear and complete, in a task manager.
Read the task given as JSON and find what is missing or unclear to do it (or to fill its empty fields).
Ask at most 6 short questions, most useful first; none about what the task or its comments already say.
For each, offer 2 to 5 likely answers when you can guess them (else none).
Write in the language of the task. Answer with one JSON object and nothing else:
{"questions": [{"question": string, "options": [string]}]}
No question when nothing is missing: {"questions": []}.`;

export interface Question {
  question: string;
  options: string[];
}

/** The questions of an answer, checked and capped. */
export function cleanQuestions(answer: Record<string, unknown>): Question[] {
  const list = Array.isArray(answer.questions) ? answer.questions : [];
  return list
    .map((q) => ({
      question: typeof q?.question === "string" ? q.question.trim().slice(0, 500) : "",
      options: (Array.isArray(q?.options) ? q.options : []).filter((o: unknown) => typeof o === "string" && o.trim())
        .map((o: string) => o.trim().slice(0, 200)).slice(0, 5),
    }))
    .filter((q) => q.question)
    .slice(0, 6);
}

/** What the assistant asks to complete the task or clear up what is vague. */
export async function assistQuestions(t: Row): Promise<Question[]> {
  const { cfg, kindRules, facts } = await context(t);
  const text = await complete(cfg, QUESTIONS + kindRules, [{ role: "user", content: JSON.stringify(facts) }], { maxTokens: 4000 });
  return cleanQuestions(parseAnswer(text));
}

const DISCUSSION = `You help a person clarify one of their tasks, in a task manager. The task is given as JSON below.
Discuss it with them: answer briefly, ask one thing at a time, suggest options. Never invent facts about the task.
Write in the language the person writes in. Plain text or short Markdown.`;

/** The assistant's next message in a discussion about the task. */
export async function assistDiscussion(t: Row, messages: AiMessage[]): Promise<string> {
  if (!messages.length || messages.at(-1)!.role !== "user") throw bad("Write a message first");
  const { cfg, kindRules, facts } = await context(t);
  const text = await complete(cfg, `${DISCUSSION}${kindRules}\n\nThe task:\n${JSON.stringify(facts)}`, messages, { maxTokens: 2000 });
  return text.trim().slice(0, 8000);
}

const SEARCH_QUERIES = `You help a person find tasks in a task manager whose search matches tasks containing every word given.
Turn their question into at most 4 short searches of 1 to 3 words each (words likely written in the tasks: names,
subjects; in the language of the question, singular), most likely first. Answer with one JSON object and nothing else:
{"queries": [string]}`;

const SEARCH_ANSWER = `You help a person find tasks in a task manager. Their question and the tasks found are given as JSON.
Answer the question in a few sentences using only these tasks, naming them by key (e.g. TP-12); say so when none fits.
Write in the language of the question. Answer with one JSON object and nothing else:
{"answer": string, "tasks": [the keys of the tasks that answer the question, most relevant first]}`;

/** The assistant's answer to a question about one's tasks, with the tasks it names (only tasks the person sees). */
export async function assistSearch(userId: string, lang: Locale, question: string) {
  const q = question.trim().slice(0, 500);
  if (!q) throw bad("Ask a question first");
  const cfg = aiConfig();
  if (!cfg?.model) throw bad("No AI assistant is set up on this instance");
  const queries = parseAnswer(await complete(cfg, SEARCH_QUERIES, [{ role: "user", content: q }], { maxTokens: 1000 })).queries;
  const words = [q, ...(Array.isArray(queries) ? queries : [])].filter((x): x is string => typeof x === "string" && Boolean(x.trim())).slice(0, 5);
  const found = new Map<string, Awaited<ReturnType<typeof searchTasks>>[number]>();
  for (const w of words) {
    for (const r of await searchTasks(userId, lang, w.slice(0, 200))) {
      // Confidential tasks never reach the AI.
      if (!r.confidential && found.size < 40) found.set(r.id, r);
    }
  }
  const tasks = [...found.values()];
  if (!tasks.length) return { answer: null, tasks: [] };
  const plain = (s: string | null) => (s ?? "").replace(/[\u0002\u0003]/g, "");
  const facts = tasks.map((r) => ({ key: r.key, title: r.title, status: r.status, where: [r.space.name, r.pipe?.name, r.column].filter(Boolean).join(" › "), owner: r.owner?.name ?? null, excerpt: plain(r.snippet) }));
  const answer = parseAnswer(await complete(cfg, SEARCH_ANSWER, [{ role: "user", content: JSON.stringify({ question: q, tasks: facts }) }], { maxTokens: 2000 }));
  const keys = (Array.isArray(answer.tasks) ? answer.tasks : []).map(String);
  const named = keys.map((k) => tasks.find((r) => r.key === k)).filter((r): r is (typeof tasks)[number] => Boolean(r));
  return {
    answer: typeof answer.answer === "string" ? answer.answer.trim().slice(0, 4000) : null,
    tasks: [...new Set(named)],
  };
}
