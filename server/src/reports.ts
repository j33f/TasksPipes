/**
 * Time spent per step, daily activity reports and weekly time reports, all computed from the history of tasks
 * (each event records the state before and after it, with its time).
 *
 * Reports can be read in the app for any day, and sent by e-mail at REPORT_HOUR (local to TIMEZONE): the daily
 * report of the pipes that ask for it, every day, and on Fridays the weekly time report of the pipes that ask
 * for it. Each sending is recorded, so it happens once even across restarts.
 */
import { config } from "./config.js";
import { one, query, type Queryable } from "./db.js";
import { intlTag, localize, tr, type Locale } from "./i18n.js";
import { sendHtmlMail } from "./mail.js";
import { TASK_KEY_PREFIX } from "./git.js";
import { pipeTypeById, stageLabel, taskTypeById, type Status } from "./pipeTypes.js";
import { dailyPeriod, isDay, lastWeekday, localDay, weeklyPeriod, zonedParts, type Period } from "./time.js";
import { loggedInPeriod } from "./worklog.js";

/** Statuses of a task being worked on. */
const ACTIVE: Status[] = ["started", "ongoing"];

// ---------------------------------------------------------------------------
// Time per step of one task

export interface StepEvent {
  createdAt: Date | string;
  to: { status: Status | null; stage: string | null; location: { incoming: boolean } | null };
}

export interface Timing {
  /** Time spent in each step (column, or incoming bucket), in order of first visit. */
  steps: { label: string | null; incoming: boolean; status: Status | null; ms: number }[];
  /** The step the task is in now, since when. */
  current: { label: string | null; incoming: boolean; since: string } | null;
  /** From creation to done (or now). */
  leadMs: number;
  /** From the first start to done (or now); null if never started. */
  cycleMs: number | null;
  done: boolean;
}

/** Where a task is after an event: its column, or an incoming bucket. */
const stepOf = (e: StepEvent) => ({
  incoming: Boolean(e.to.location?.incoming),
  label: e.to.location?.incoming ? null : e.to.stage,
  status: e.to.status,
});

export function stepTimes(events: StepEvent[], now = new Date()): Timing {
  const timed = events.map((e) => ({ at: new Date(e.createdAt).getTime(), step: stepOf(e) })).sort((a, b) => a.at - b.at);
  const steps: Timing["steps"] = [];
  const add = (step: ReturnType<typeof stepOf>, ms: number) => {
    const key = (s: { incoming: boolean; label: string | null }) => `${s.incoming}|${s.label}`;
    const found = steps.find((s) => key(s) === key(step));
    if (found) found.ms += ms;
    else steps.push({ ...step, ms });
  };
  let firstActive: number | null = null;
  let doneAt: number | null = null;
  for (const [i, e] of timed.entries()) {
    const until = timed[i + 1]?.at ?? now.getTime();
    add(e.step, Math.max(0, until - e.at));
    if (e.step.status && ACTIVE.includes(e.step.status) && firstActive === null) firstActive = e.at;
    // Done is the last word: reopening the task forgets it.
    doneAt = e.step.status === "done" ? (doneAt ?? e.at) : null;
  }
  const last = timed.at(-1);
  const start = timed[0]?.at ?? now.getTime();
  const end = doneAt ?? now.getTime();
  return {
    steps: steps.filter((s) => s.ms > 0 || s === steps.at(-1)),
    current: last && !doneAt ? { label: last.step.label, incoming: last.step.incoming, since: new Date(last.at).toISOString() } : null,
    leadMs: end - start,
    cycleMs: firstActive === null ? null : end - firstActive,
    done: doneAt !== null,
  };
}

// ---------------------------------------------------------------------------
// Pipe reports

/** One entry of a task's history, as stored. */
export interface EventRow {
  task_id: string;
  type: string;
  created_at: Date;
  from_status: Status | null;
  to_status: Status;
  from_pipe_id: string | null;
  to_pipe_id: string | null;
  to_stage: string | null;
}

export interface TaskInfo {
  id: string;
  number: number;
  title: string;
  taskType: string;
  owner: string | null;
}

export interface ReportTask extends TaskInfo {
  /** Column (label) it was in at that moment. */
  stage: string | null;
}

export interface DailyReport {
  period: { start: string; end: string };
  created: ReportTask[];
  started: ReportTask[];
  done: ReportTask[];
  blocked: ReportTask[];
  dropped: ReportTask[];
  /** Where things stand at the end of the period. */
  inProgress: ReportTask[];
  stillBlocked: ReportTask[];
}

/** Events per task, in order. */
function byTask(events: EventRow[]) {
  const map = new Map<string, EventRow[]>();
  for (const e of [...events].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
    if (!map.has(e.task_id)) map.set(e.task_id, []);
    map.get(e.task_id)!.push(e);
  }
  return map;
}

/** A task's state at an instant: the state after its last event before then. */
function stateAt(events: EventRow[], at: Date) {
  let last: EventRow | undefined;
  for (const e of events) if (e.created_at < at) last = e;
  return last;
}

export function dailyReport(pipeId: string, tasks: Map<string, TaskInfo>, events: EventRow[], period: Period): DailyReport {
  const report: DailyReport = {
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    created: [], started: [], done: [], blocked: [], dropped: [], inProgress: [], stillBlocked: [],
  };
  const put = (list: ReportTask[], id: string, stage: string | null) => {
    const t = tasks.get(id);
    if (!t) return;
    const at = list.findIndex((x) => x.id === id);
    if (at >= 0) list.splice(at, 1);
    list.push({ ...t, stage });
  };
  for (const [id, list] of byTask(events)) {
    for (const e of list) {
      if (e.created_at < period.start || e.created_at >= period.end || e.to_pipe_id !== pipeId) continue;
      // Entering a state from another one, or from another place.
      const entered = (s: Status[]) => s.includes(e.to_status) && !(e.from_status && s.includes(e.from_status) && e.from_pipe_id === pipeId);
      if (e.type === "created" || (e.from_pipe_id !== pipeId && ["accepted", "moved"].includes(e.type))) put(report.created, id, e.to_stage);
      if (entered(ACTIVE)) put(report.started, id, e.to_stage);
      if (entered(["done"])) put(report.done, id, e.to_stage);
      if (entered(["blocked"])) put(report.blocked, id, e.to_stage);
      if (entered(["abandoned"])) put(report.dropped, id, e.to_stage);
    }
    const end = stateAt(list, period.end);
    if (end?.to_pipe_id === pipeId) {
      if (ACTIVE.includes(end.to_status)) put(report.inProgress, id, end.to_stage);
      if (end.to_status === "blocked") put(report.stillBlocked, id, end.to_stage);
    }
  }
  return report;
}

export interface WeeklyReport {
  /** Time logged by hand during the week (worklog.ts), when there is some. */
  logged?: Awaited<ReturnType<typeof loggedInPeriod>>;
  period: { start: string; end: string };
  /** Per task type: time being worked on, time blocked, tasks worked on, tasks done. */
  byType: { taskType: string; activeMs: number; blockedMs: number; tasks: number; done: number }[];
  /** The tasks that took the most time. */
  tasks: (TaskInfo & { activeMs: number; blockedMs: number; done: boolean })[];
  totalActiveMs: number;
}

export function weeklyReport(pipeId: string, tasks: Map<string, TaskInfo>, events: EventRow[], period: Period): WeeklyReport {
  const start = period.start.getTime();
  const end = period.end.getTime();
  const perTask = new Map<string, { activeMs: number; blockedMs: number; done: boolean }>();
  for (const [id, list] of byTask(events)) {
    const acc = { activeMs: 0, blockedMs: 0, done: false };
    for (const [i, e] of list.entries()) {
      const from = Math.max(start, e.created_at.getTime());
      const to = Math.min(end, list[i + 1]?.created_at.getTime() ?? end);
      if (to > from && e.to_pipe_id === pipeId) {
        if (ACTIVE.includes(e.to_status)) acc.activeMs += to - from;
        if (e.to_status === "blocked") acc.blockedMs += to - from;
      }
      const at = e.created_at.getTime();
      if (at >= start && at < end && e.to_pipe_id === pipeId && e.to_status === "done" && e.from_status !== "done") acc.done = true;
    }
    if (acc.activeMs || acc.blockedMs || acc.done) perTask.set(id, acc);
  }
  const byType = new Map<string, WeeklyReport["byType"][number]>();
  const list: WeeklyReport["tasks"] = [];
  for (const [id, acc] of perTask) {
    const t = tasks.get(id);
    if (!t) continue;
    list.push({ ...t, ...acc });
    const row = byType.get(t.taskType) ?? { taskType: t.taskType, activeMs: 0, blockedMs: 0, tasks: 0, done: 0 };
    row.activeMs += acc.activeMs;
    row.blockedMs += acc.blockedMs;
    row.tasks += 1;
    row.done += acc.done ? 1 : 0;
    byType.set(t.taskType, row);
  }
  return {
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    byType: [...byType.values()].sort((a, b) => b.activeMs - a.activeMs),
    tasks: list.sort((a, b) => b.activeMs - a.activeMs).slice(0, 20),
    totalActiveMs: list.reduce((n, t) => n + t.activeMs, 0),
  };
}

// ---------------------------------------------------------------------------
// Loading from the database

/** History (up to `end`) and details of every task that has been in the pipe. */
async function loadPipeHistory(pipeId: string, end: Date, db?: Queryable) {
  const events = (
    await query(
      `SELECT e.task_id, e.type, e.created_at, e.from_status, e.to_status, e.from_pipe_id, e.to_pipe_id, e.to_stage
       FROM task_events e
       WHERE e.task_id IN (SELECT DISTINCT task_id FROM task_events WHERE to_pipe_id = $1 OR from_pipe_id = $1) AND e.created_at < $2
       ORDER BY e.created_at, e.id`,
      [pipeId, end],
      db
    )
  ).rows as EventRow[];
  const ids = [...new Set(events.map((e) => e.task_id))];
  const tasks = new Map<string, TaskInfo>();
  if (ids.length) {
    const { rows } = await query(
      `SELECT t.id, t.number, t.title, t.task_type, COALESCE(asg.name, su.name) AS owner
       FROM tasks t JOIN spaces s ON s.id = t.space_id LEFT JOIN users su ON su.id = s.user_id
       LEFT JOIN users asg ON asg.id = t.assignee_id WHERE t.id = ANY($1)`,
      [ids],
      db
    );
    for (const r of rows) tasks.set(r.id, { id: r.id, number: r.number, title: r.title, taskType: r.task_type, owner: r.owner });
  }
  return { events, tasks };
}

/** Daily report of a pipe for a local day (from the day before at REPORT_HOUR). */
export async function pipeDailyReport(pipeId: string, day: string) {
  const period = dailyPeriod(day, config.reportHour, config.timezone);
  const { events, tasks } = await loadPipeHistory(pipeId, period.end);
  return dailyReport(pipeId, tasks, events, period);
}

/** Weekly time report of a pipe for the week ending on a local day at REPORT_HOUR. */
export async function pipeWeeklyReport(pipeId: string, day: string) {
  const period = weeklyPeriod(day, config.reportHour, config.timezone);
  const { events, tasks } = await loadPipeHistory(pipeId, period.end);
  return { ...weeklyReport(pipeId, tasks, events, period), logged: await loggedInPeriod(pipeId, period) };
}

/** Today (local) once the report hour has passed, else yesterday: the latest finished report day. */
export function latestReportDay(now = new Date()): string {
  const day = localDay(now, config.timezone);
  return now >= dailyPeriod(day, config.reportHour, config.timezone).end ? day : localDay(new Date(now.getTime() - 86400_000), config.timezone);
}

export const latestReportWeek = (now = new Date()) => lastWeekday(latestReportDay(now), 5);

export const reportDay = (v: unknown, fallback: string) => (isDay(v) ? v : fallback);

// ---------------------------------------------------------------------------
// E-mails

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** "3 d 4 h", "5 h 20", "45 min" in a language. */
export function duration(ms: number, lang: Locale): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return tr(lang, "{n} min", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? tr(lang, "{h} h {m}", { h, m: String(min % 60).padStart(2, "0") }) : tr(lang, "{h} h", { h });
  return h % 24 ? tr(lang, "{d} d {h} h", { d: Math.floor(h / 24), h: h % 24 }) : tr(lang, "{d} d", { d: Math.floor(h / 24) });
}

/** Working time in hours, never in days: "45 min", "26 h 30". */
export function workDuration(minutes: number, lang: Locale): string {
  if (minutes < 60) return tr(lang, "{n} min", { n: minutes });
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? tr(lang, "{h} h {m}", { h, m: String(minutes % 60).padStart(2, "0") }) : tr(lang, "{h} h", { h });
}

interface PipeRow {
  id: string;
  name: string;
  kind: string;
  space_id: string;
}

const taskLine = (lang: Locale, kind: string, t: ReportTask | TaskInfo, extra = "") => {
  const stage = "stage" in t && t.stage ? ` · ${escape(localize(lang, stageLabel(kind, t.stage) ?? t.stage))}` : "";
  return `<li><a href="${config.appUrl}/?task=${t.id}" style="color:#0366d6;text-decoration:none">${TASK_KEY_PREFIX}-${t.number}</a> ${escape(t.title)}`
    + `<span style="color:#66778F">${stage}${t.owner ? ` · ${escape(t.owner)}` : ""}${extra}</span></li>`;
};

export function dailyEmail(pipe: PipeRow, r: DailyReport, lang: Locale, day: string) {
  const sections: [string, ReportTask[]][] = [
    ["New in the pipe", r.created], ["Tasks started", r.started], ["Tasks done", r.done], ["Tasks blocked", r.blocked], ["Tasks dropped", r.dropped],
    ["Still in progress", r.inProgress], ["Still blocked", r.stillBlocked],
  ];
  const html = sections
    .filter(([, list]) => list.length)
    .map(([title, list]) => `<h3 style="font-size:15px;margin:18px 0 6px">${escape(tr(lang, title))} (${list.length})</h3><ul style="padding-left:18px;margin:0">${list.map((t) => taskLine(lang, pipe.kind, t)).join("")}</ul>`)
    .join("");
  return {
    subject: tr(lang, "Activity of {pipe} — {day}", { pipe: pipe.name, day }),
    html: wrap(lang, tr(lang, "Activity of {pipe} — {day}", { pipe: pipe.name, day }), tr(lang, "From {start} to {end}.", { start: when(r.period.start, lang), end: when(r.period.end, lang) }), html, pipe),
    empty: sections.every(([, list]) => !list.length),
  };
}

export function weeklyEmail(pipe: PipeRow, r: WeeklyReport, lang: Locale, day: string) {
  const td = (s: string, right = false) => `<td style="padding:4px 10px 4px 0;${right ? "text-align:right;" : ""}border-bottom:1px solid #e5e7eb">${s}</td>`;
  const table = r.byType.length
    ? `<table style="border-collapse:collapse;font-size:14px"><tr style="color:#66778F">${td(tr(lang, "Task type"))}${td(tr(lang, "In progress"), true)}${td(tr(lang, "Blocked"), true)}${td(tr(lang, "Tasks"), true)}${td(tr(lang, "Done"), true)}</tr>`
      + r.byType.map((row) => `<tr>${td(escape(localize(lang, taskTypeById(row.taskType)?.label ?? row.taskType)))}${td(duration(row.activeMs, lang), true)}${td(duration(row.blockedMs, lang), true)}${td(String(row.tasks), true)}${td(String(row.done), true)}</tr>`).join("")
      + `</table>`
    : `<p>${escape(tr(lang, "No time recorded this week."))}</p>`;
  // Durations only: notes stay in the app.
  const logged = r.logged?.totalMinutes
    ? `<h3 style="font-size:15px;margin:18px 0 6px">${escape(tr(lang, "Time logged: {total}", { total: workDuration(r.logged.totalMinutes, lang) }))}</h3>`
      + `<p style="margin:0">${r.logged.byPerson.map((p) => `${escape(p.name)} ${workDuration(p.minutes, lang)}`).join(" · ")}</p>`
      + `<ul style="padding-left:18px;margin:6px 0 0">${r.logged.tasks.slice(0, 10).map((t) => taskLine(lang, pipe.kind, t, ` · ${workDuration(t.minutes, lang)}`
        + (t.estimateMinutes ? ` · ${escape(tr(lang, "{logged} of {estimate} estimated", { logged: workDuration(t.totalMinutes, lang), estimate: workDuration(t.estimateMinutes, lang) }))}` : ""))).join("")}</ul>`
    : "";
  const top = r.tasks.length
    ? `<h3 style="font-size:15px;margin:18px 0 6px">${escape(tr(lang, "Tasks that took the most time"))}</h3><ul style="padding-left:18px;margin:0">${r.tasks.slice(0, 10).map((t) => taskLine(lang, pipe.kind, t, ` · ${duration(t.activeMs, lang)}`)).join("")}</ul>`
    : "";
  return {
    subject: tr(lang, "Time report of {pipe} — week to {day}", { pipe: pipe.name, day }),
    html: wrap(lang, tr(lang, "Time report of {pipe} — week to {day}", { pipe: pipe.name, day }),
      tr(lang, "Time spent on tasks being worked on, from {start} to {end}: {total}.", { start: when(r.period.start, lang), end: when(r.period.end, lang), total: duration(r.totalActiveMs, lang) }),
      table + top + logged, pipe),
    empty: !r.tasks.length && !r.logged?.totalMinutes,
  };
}

const when = (iso: string, lang: Locale) =>
  new Intl.DateTimeFormat(intlTag(lang), { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const wrap = (lang: Locale, title: string, intro: string, body: string, pipe: PipeRow) =>
  `<div lang="${lang}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#111319;max-width:640px">`
  + `<h2 style="font-size:18px;margin:0 0 4px">${escape(title)}</h2><p style="color:#66778F;margin:0 0 8px">${escape(intro)}</p>${body}`
  + `<p style="margin-top:24px"><a href="${config.appUrl}/pipes/${pipe.id}" style="color:#0366d6">${escape(tr(lang, "Open the pipe"))}</a></p>`
  + `<p style="color:#66778F;font-size:12px">${escape(tr(lang, "You receive this e-mail because the pipe sends its reports to the members of its space."))}</p></div>`;

// ---------------------------------------------------------------------------
// Scheduled sending

/** Records a sending; false if it was already done (by this or another run). */
async function claim(kind: string, end: Date) {
  return Boolean(await one(`INSERT INTO report_runs (kind, period_end) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING kind`, [kind, end]));
}

type Send = (lang: Locale, to: string, subject: string, html: string) => Promise<unknown>;

async function recipients(spaceId: string) {
  const { rows } = await query(
    `SELECT u.email, u.locale FROM space_members m JOIN users u ON u.id = m.user_id
     WHERE m.space_id = $1 AND u.email IS NOT NULL AND u.auth_kind <> 'system' AND u.disabled_at IS NULL
       AND u.last_login_at IS NOT NULL`,
    [spaceId]
  );
  return rows as { email: string; locale: Locale | null }[];
}

/**
 * Sends the reports that are due (call it every few minutes): the daily ones once the report hour has passed,
 * and on Fridays the weekly ones. Returns how many e-mails went out.
 */
export async function runScheduledReports(now = new Date(), send: Send = (l, to, s, h) => sendHtmlMail(l, to, s, h)): Promise<number> {
  const day = localDay(now, config.timezone);
  const end = dailyPeriod(day, config.reportHour, config.timezone).end;
  if (now < end) return 0;
  let sent = 0;
  const deliver = async (pipe: PipeRow, build: (lang: Locale) => { subject: string; html: string; empty: boolean }) => {
    for (const r of await recipients(pipe.space_id)) {
      const mail = build(r.locale ?? config.defaultLocale);
      if (mail.empty) return;
      await send(r.locale ?? config.defaultLocale, r.email, mail.subject, mail.html).then(() => sent++, () => {});
    }
  };
  if (await claim("daily", end)) {
    const { rows } = await query(`SELECT id, name, kind, space_id FROM pipes WHERE daily_report AND archived_at IS NULL`);
    for (const pipe of rows as PipeRow[]) {
      const report = await pipeDailyReport(pipe.id, day);
      await deliver(pipe, (lang) => dailyEmail(pipe, report, lang, day));
    }
  }
  if (zonedParts(now, config.timezone).weekday === "Fri" && (await claim("weekly", end))) {
    const { rows } = await query(`SELECT id, name, kind, space_id FROM pipes WHERE weekly_report AND archived_at IS NULL`);
    for (const pipe of rows as PipeRow[]) {
      if (!pipeTypeById(pipe.kind)?.timeReport) continue;
      const report = await pipeWeeklyReport(pipe.id, day);
      await deliver(pipe, (lang) => weeklyEmail(pipe, report, lang, day));
    }
  }
  return sent;
}
