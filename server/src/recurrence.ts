/**
 * Recurring tasks: a series (task_recurrences) makes a new task — an occurrence — on each date of its rule: daily,
 * weekly on chosen days, monthly (a day of the month, the n-th or last weekday, the last business day) or yearly,
 * every n periods, until an optional end. Either at fixed dates (a set number of days ahead), or once the previous
 * occurrence is done. Each occurrence copies the latest one; the scheduler makes them, never twice for a date.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, query, tx, type Queryable, type Row } from "./db.js";
import { bad, notFound, forbidden } from "./errors.js";
import { getTaskRow, taskPermissions } from "./access.js";
import { pipeTypeById, resolveStage } from "./pipeTypes.js";
import { addDays, isDay, localDay } from "./time.js";

/** 1 = Monday … 7 = Sunday (ISO). */
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Monthly =
  | { kind: "day"; day: number }
  /** The n-th weekday of the month (1 to 4), or the last one (-1). */
  | { kind: "weekday"; nth: 1 | 2 | 3 | 4 | -1; weekday: Weekday }
  /** The last Monday-to-Friday of the month (public holidays are not known). */
  | { kind: "lastBusinessDay" };

export interface Rule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  /** Every n days, weeks, months or years. */
  interval: number;
  /** Weekly: the days. */
  weekdays?: Weekday[];
  /** Monthly: which day. */
  monthly?: Monthly;
}

export type Mode = "schedule" | "after_done";
export const MAX_LEAD_DAYS = 90;

// ---------------------------------------------------------------------------
// Dates (days as YYYY-MM-DD, computed in UTC: no time of day, no time zone)

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);
/** ISO weekday of a day: 1 = Monday … 7 = Sunday. */
export const weekday = (day: string) => ((toDate(day).getUTCDay() + 6) % 7) + 1;
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => fromDate(new Date(Date.UTC(y, m, d)));

/** The day a monthly rule falls on in a month (m: 0-11); a day beyond the month's end is its last day. */
export function monthlyDay(rule: Monthly, y: number, m: number): string {
  const last = daysInMonth(y, m);
  if (rule.kind === "day") return ymd(y, m, Math.min(rule.day, last));
  if (rule.kind === "lastBusinessDay") {
    let d = last;
    while (weekday(ymd(y, m, d)) > 5) d--;
    return ymd(y, m, d);
  }
  if (rule.nth === -1) {
    let d = last;
    while (weekday(ymd(y, m, d)) !== rule.weekday) d--;
    return ymd(y, m, d);
  }
  const first = weekday(ymd(y, m, 1));
  return ymd(y, m, 1 + ((rule.weekday - first + 7) % 7) + (rule.nth - 1) * 7);
}

/** The first date of the rule strictly after `after`, counting periods from `start` (the first occurrence). */
export function nextDate(rule: Rule, start: string, after: string): string {
  const n = Math.max(1, rule.interval);
  if (rule.freq === "daily") {
    const k = Math.max(0, Math.floor(daysBetween(start, after) / n) + 1);
    return addDays(start, k * n);
  }
  if (rule.freq === "weekly") {
    const days = rule.weekdays?.length ? rule.weekdays : [weekday(start) as Weekday];
    // Weeks start on Monday; only every n-th week from the start's counts.
    const startMonday = addDays(start, 1 - weekday(start));
    for (let d = addDays(after, 1), i = 0; i < 7 * n + 7; d = addDays(d, 1), i++) {
      const week = Math.floor(daysBetween(startMonday, d) / 7);
      if (week >= 0 && week % n === 0 && days.includes(weekday(d) as Weekday) && d >= start) return d;
    }
    throw new Error("no weekly date found");
  }
  const s = toDate(start);
  if (rule.freq === "monthly") {
    const monthly = rule.monthly ?? { kind: "day", day: s.getUTCDate() };
    const a = toDate(after);
    // From the month of `after` (or of the start), the first matching month after it.
    let k = Math.max(0, (a.getUTCFullYear() - s.getUTCFullYear()) * 12 + a.getUTCMonth() - s.getUTCMonth());
    k -= k % n;
    for (let i = 0; i < 1200; i++, k += n) {
      const y = s.getUTCFullYear() + Math.floor((s.getUTCMonth() + k) / 12);
      const d = monthlyDay(monthly, y, (s.getUTCMonth() + k) % 12);
      if (d > after && d >= start) return d;
    }
    throw new Error("no monthly date found");
  }
  // Yearly: the start's day of the year (29 February falls on the 28th in other years).
  let year = Math.max(s.getUTCFullYear(), toDate(after).getUTCFullYear());
  year -= (year - s.getUTCFullYear()) % n;
  for (let i = 0; i < 200; i++, year += n) {
    const d = ymd(year, s.getUTCMonth(), Math.min(s.getUTCDate(), daysInMonth(year, s.getUTCMonth())));
    if (d > after && d >= start) return d;
  }
  throw new Error("no yearly date found");
}

/** The next `count` dates after `after`, before an optional end. */
export function upcoming(rule: Rule, start: string, after: string, count: number, endsOn: string | null = null): string[] {
  const out: string[] = [];
  for (let d = after; out.length < count; ) {
    d = nextDate(rule, start, d);
    if (endsOn && d > endsOn) break;
    out.push(d);
  }
  return out;
}

/** A rule as given by the app, checked; throws on anything else. */
export function cleanRule(input: unknown): Rule {
  const r = (input ?? {}) as Record<string, unknown>;
  const freq = r.freq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly") throw bad("Invalid repetition");
  const interval = Number(r.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) throw bad("Invalid repetition");
  const rule: Rule = { freq, interval };
  if (freq === "weekly") {
    const days = Array.isArray(r.weekdays) ? [...new Set(r.weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort() : [];
    if (!days.length) throw bad("Choose at least one day of the week");
    rule.weekdays = days as Weekday[];
  }
  if (freq === "monthly") {
    const m = (r.monthly ?? {}) as Record<string, unknown>;
    if (m.kind === "day" && Number.isInteger(Number(m.day)) && Number(m.day) >= 1 && Number(m.day) <= 31) rule.monthly = { kind: "day", day: Number(m.day) };
    else if (m.kind === "weekday" && [1, 2, 3, 4, -1].includes(Number(m.nth)) && Number(m.weekday) >= 1 && Number(m.weekday) <= 7) {
      rule.monthly = { kind: "weekday", nth: Number(m.nth) as 1 | 2 | 3 | 4 | -1, weekday: Number(m.weekday) as Weekday };
    } else if (m.kind === "lastBusinessDay") rule.monthly = { kind: "lastBusinessDay" };
    else throw bad("Invalid repetition");
  }
  return rule;
}

// ---------------------------------------------------------------------------
// Occurrences

const today = (now: Date) => localDay(now, config.timezone);

/** Makes the occurrence of `day`: a copy of the series' latest task (sub-tasks unchecked), in the first column. */
async function createOccurrence(db: Queryable, s: Row, day: string, record: RecordCreated): Promise<string | null> {
  const last = await one(
    `SELECT t.* FROM tasks t WHERE t.recurrence_id = $1 ORDER BY t.occurrence_on DESC NULLS LAST, t.created_at DESC LIMIT 1`,
    [s.id], db
  );
  const pipe = last?.pipe_id ? await one(`SELECT id, kind, archived_at FROM pipes WHERE id = $1`, [last.pipe_id], db) : null;
  // Nothing left to copy, or nowhere to put it: the series stops.
  if (!last || !pipe || pipe.archived_at) {
    await db.query(`UPDATE task_recurrences SET active = false, updated_at = now() WHERE id = $1`, [s.id]);
    return null;
  }
  const column = resolveStage(pipe.kind, null, "backlog");
  const first = (pipeTypeById(pipe.kind)?.columns ?? [column])[0];
  const position = (await one(`SELECT COALESCE(min(position), 1) - 1 AS p FROM tasks WHERE pipe_id = $1 AND stage = $2`, [pipe.id, first.id], db))!.p;
  const row = await one(
    `INSERT INTO tasks (title, description, space_id, pipe_id, status, stage, position, assignee_id, due_date, outline_doc_id,
                        outline_doc_title, outline_doc_url, author_id, task_type, fields, recurrence_id, occurrence_on, priority, estimate_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$9,$17,$18)
     ON CONFLICT (recurrence_id, occurrence_on) WHERE recurrence_id IS NOT NULL DO NOTHING RETURNING id`,
    [last.title, last.description, last.space_id, pipe.id, first.status, first.id, position, last.assignee_id, day,
     last.outline_doc_id, last.outline_doc_title, last.outline_doc_url, s.created_by ?? last.author_id, last.task_type,
     JSON.stringify(last.fields), s.id, last.priority, last.estimate_minutes],
    db
  );
  if (!row) return null;
  await db.query(`INSERT INTO task_labels (task_id, label_id) SELECT $1, label_id FROM task_labels WHERE task_id = $2`, [row.id, last.id]);
  await db.query(
    `INSERT INTO task_items (task_id, text, done, position) SELECT $1, text, false, position FROM task_items WHERE task_id = $2`,
    [row.id, last.id]
  );
  await record(db, row.id, s.created_by ?? last.author_id, s.id);
  return row.id;
}

/** How routes.ts records a task's creation in its history (with notifications and webhooks). */
export type RecordCreated = (db: Queryable, taskId: string, actorId: string, recurrenceId: string) => Promise<void>;

/**
 * Makes the occurrences due: at fixed dates, those within their lead time; after completion, the next one once the
 * latest is done. Missed dates (the app was off) are skipped but the latest. Each series is claimed by moving its
 * next date in the same transaction, and a unique index on (series, date) forbids twins. Returns how many were made.
 */
export async function runRecurrences(record: RecordCreated, now = new Date()): Promise<number> {
  const day = today(now);
  const { rows } = await query(
    `SELECT r.* FROM task_recurrences r WHERE r.active AND r.next_on IS NOT NULL AND (
       (r.mode = 'schedule' AND r.next_on - r.lead_days <= $1::date)
       OR (r.mode = 'after_done' AND NOT EXISTS (
             SELECT 1 FROM tasks t WHERE t.recurrence_id = r.id AND t.status NOT IN ('done', 'abandoned'))))`,
    [day]
  );
  let made = 0;
  for (const s of rows) {
    await tx(async (client) => {
      const rule = s.rule as Rule;
      const start = localDayOf(s.starts_on);
      let date = localDayOf(s.next_on);
      // Skip dates gone by, keeping the latest one (at fixed dates) — or only dates to come (after completion).
      if (s.mode === "schedule") {
        for (let n = nextDate(rule, start, date); addDays(n, -s.lead_days) <= day && (!s.ends_on || n <= localDayOf(s.ends_on)); n = nextDate(rule, start, n)) {
          if (n > day) break;
          date = n;
        }
      } else {
        while (date < day) date = nextDate(rule, start, date);
      }
      if (s.ends_on && date > localDayOf(s.ends_on)) {
        await client.query(`UPDATE task_recurrences SET active = false, next_on = NULL, updated_at = now() WHERE id = $1`, [s.id]);
        return;
      }
      const next = nextDate(rule, start, date);
      const claimed = await client.query(
        `UPDATE task_recurrences SET next_on = $3, updated_at = now() WHERE id = $1 AND next_on = $2 AND active RETURNING id`,
        [s.id, s.next_on, s.ends_on && next > localDayOf(s.ends_on) ? null : next]
      );
      if (!claimed.rowCount) return;
      if (await createOccurrence(client, s, date, record)) made++;
    });
  }
  return made;
}

/** A date column (read as text, see db.ts) as YYYY-MM-DD. */
const localDayOf = (v: unknown) => String(v).slice(0, 10);

// ---------------------------------------------------------------------------
// Routes: a task's repetition, set by those who manage the task

export function presentRecurrence(r: Row | null) {
  if (!r) return null;
  const start = localDayOf(r.starts_on);
  const next = r.next_on ? localDayOf(r.next_on) : null;
  return {
    id: r.id, rule: r.rule as Rule, mode: r.mode as Mode, leadDays: r.lead_days, startsOn: start,
    endsOn: r.ends_on ? localDayOf(r.ends_on) : null, nextOn: next, active: r.active,
    upcoming: r.active && next ? [next, ...upcoming(r.rule, start, next, 2, r.ends_on ? localDayOf(r.ends_on) : null)] : [],
  };
}

async function manageableTask(req: FastifyRequest<{ Params: { id: string } }>) {
  const t = /^[0-9a-f-]{36}$/i.test(req.params.id) ? await getTaskRow(req.params.id) : null;
  if (!t) throw notFound("Task not found");
  const perms = await taskPermissions(t, req.user!.id);
  if (!perms.view) throw notFound("Task not found");
  if (!perms.manage) throw forbidden();
  if (!t.pipe_id) throw bad("Only a task in a pipe can repeat");
  return t;
}

export async function recurrenceRoutes(app: FastifyInstance) {
  // Sets (or changes) the repetition of a task: the task is the series' first occurrence, on its due date.
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>("/tasks/:id/recurrence", async (req) => {
    const t = await manageableTask(req);
    const b = req.body ?? {};
    const rule = cleanRule(b.rule);
    const mode: Mode = b.mode === "after_done" ? "after_done" : "schedule";
    const leadDays = Number(b.leadDays ?? 0);
    if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > MAX_LEAD_DAYS) throw bad("Create it at most {n} days ahead", { n: MAX_LEAD_DAYS });
    const endsOn = b.endsOn ? String(b.endsOn) : null;
    if (endsOn && !isDay(endsOn)) throw bad("Invalid end date");
    const start = t.occurrence_on ? localDayOf(t.occurrence_on) : t.due_date ? localDayOf(t.due_date) : today(new Date());
    if (endsOn && endsOn < start) throw bad("The end date comes before the first date");
    const next = nextDate(rule, start, start);
    const r = await tx(async (client) => {
      const values = [JSON.stringify(rule), mode, leadDays, start, endsOn, endsOn && next > endsOn ? null : next, req.user!.id];
      let row = t.recurrence_id && (await one(
        `UPDATE task_recurrences SET rule = $2, mode = $3, lead_days = $4, starts_on = $5, ends_on = $6, next_on = $7, active = true,
           created_by = $8, updated_at = now() WHERE id = $1 RETURNING *`,
        [t.recurrence_id, ...values], client
      ));
      if (!row) {
        row = await one(
          `INSERT INTO task_recurrences (rule, mode, lead_days, starts_on, ends_on, next_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          values, client
        );
        await client.query(`UPDATE tasks SET recurrence_id = $2, occurrence_on = $3, due_date = COALESCE(due_date, $3) WHERE id = $1`, [t.id, row!.id, start]);
      }
      return row!;
    });
    req.log.info({ taskId: t.id, recurrenceId: r.id }, "Task repetition set");
    return presentRecurrence(r);
  });

  // Stops the repetition; the tasks made so far stay.
  app.delete<{ Params: { id: string } }>("/tasks/:id/recurrence", async (req) => {
    const t = await manageableTask(req);
    if (t.recurrence_id) await query(`UPDATE task_recurrences SET active = false, next_on = NULL, updated_at = now() WHERE id = $1`, [t.recurrence_id]);
    return { ok: true };
  });
}
