/**
 * Calendar subscription (iCalendar feed) of the tasks assigned to someone that have a due date.
 * The feed lives at /cal/<token>.ics, outside the API: calendar apps (Google, Apple…) fetch it without
 * a session, so the secret token in the URL is the only credential. It is stored hashed for lookup and
 * encrypted so the person can see the link again; resetting it cuts off every subscribed calendar.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { one, query, type Row } from "./db.js";
import { decrypt, encrypt, hash } from "./auth.js";
import { localize, tr, type Locale } from "./i18n.js";
import { stageLabel } from "./pipeTypes.js";

/** Link of someone's feed, created on first use. */
export async function calendarUrl(userId: string, { reset = false } = {}): Promise<string> {
  const u = await one(`SELECT calendar_token FROM users WHERE id = $1`, [userId]);
  let token = !reset && u?.calendar_token ? decrypt(u.calendar_token) : null;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    await query(`UPDATE users SET calendar_token = $2, calendar_token_hash = $3 WHERE id = $1`, [userId, encrypt(token), hash(token)]);
  }
  return `${config.appUrl}/cal/${token}.ics`;
}

/** Text value of an iCalendar property: escaped, then folded at 75 octets. */
function prop(name: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return fold(`${name}:${escaped}`);
}

function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
    }
    current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

const day = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10).replace(/-/g, "");
};
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

/**
 * Default reminders of an open task, relative to the start of its all-day event (midnight of the due date):
 * 9:00 five days before, the day before and on the day.
 */
const ALARMS: { trigger: string; text: string }[] = [
  { trigger: "-P4DT15H", text: "Due in 5 days: {title}" },
  { trigger: "-PT15H", text: "Due tomorrow: {title}" },
  { trigger: "PT9H", text: "Due today: {title}" },
];

const alarms = (title: string, lang: Locale) =>
  ALARMS.map((a) =>
    ["BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${a.trigger}`, // The title is put in afterwards: it is the person's text, never translated.
    prop("DESCRIPTION", tr(lang, a.text).replace("{title}", title)), "END:VALARM"].join("\r\n")
  );

function event(t: Row, lang: Locale): string {
  const done = t.status === "done";
  const place = `${t.space_kind === "team" ? `${t.space_name} › ` : ""}${t.pipe_name}`;
  const column = stageLabel(t.pipe_kind, t.stage);
  const link = `${config.appUrl}/?task=${t.id}`;
  const description = [
    `${tr(lang, "Pipe")}: ${place}`,
    column ? `${tr(lang, "Column")}: ${localize(lang, column)}` : "",
    t.description ? `\n${t.description.slice(0, 2000)}` : "",
    `\n${link}`,
  ].filter(Boolean).join("\n");
  return [
    "BEGIN:VEVENT",
    `UID:task-${t.id}@${new URL(config.appUrl).hostname}`,
    `DTSTAMP:${stamp(new Date(t.updated_at))}`,
    `LAST-MODIFIED:${stamp(new Date(t.updated_at))}`,
    `DTSTART;VALUE=DATE:${day(t.due_date)}`,
    `DTEND;VALUE=DATE:${nextDay(t.due_date)}`,
    prop("SUMMARY", `${done ? "✓ " : ""}${t.title}`),
    prop("DESCRIPTION", description),
    prop("URL", link),
    "TRANSP:TRANSPARENT",
    ...(done ? ["STATUS:CONFIRMED"] : alarms(t.title, lang)),
    "END:VEVENT",
  ].join("\r\n");
}

export async function calendarRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>("/cal/:file", async (req, reply) => {
    const token = req.params.file.replace(/\.ics$/, "");
    const user = token.length >= 20 ? await one(`SELECT id, name, locale FROM users WHERE calendar_token_hash = $1`, [hash(token)]) : null;
    if (!user) return reply.code(404).type("text/plain").send("Not found");
    const lang: Locale = user.locale ?? config.defaultLocale;
    // Same tasks as "My tasks", with a due date; dropped ones are left out, done ones kept for a while.
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.status, t.stage, t.due_date, t.updated_at,
              p.name AS pipe_name, p.kind AS pipe_kind, s.kind AS space_kind, COALESCE(su.name, s.name) AS space_name
       FROM tasks t
       JOIN spaces s ON s.id = t.space_id
       LEFT JOIN users su ON su.id = s.user_id
       JOIN pipes p ON p.id = t.pipe_id
       WHERE COALESCE(t.assignee_id, s.user_id) = $1 AND t.due_date IS NOT NULL
         AND t.status <> 'abandoned' AND (t.status <> 'done' OR t.due_date > current_date - 90)
         AND p.archived_at IS NULL
         AND (EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = t.space_id AND m.user_id = $1) OR p.visibility = 'open')
       ORDER BY t.due_date LIMIT 2000`,
      [user.id]
    );
    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TasksPipes//Tasks//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      prop("X-WR-CALNAME", `TasksPipes · ${user.name}`),
      prop("X-WR-CALDESC", tr(lang, "Tasks assigned to {name} that have a due date", { name: user.name })),
      // Hints for how often to refresh (honoured by Apple Calendar and others; Google decides on its own).
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
      ...rows.map((t) => event(t, lang)),
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    return reply
      .type("text/calendar; charset=utf-8")
      .header("Content-Disposition", 'inline; filename="taskspipes.ics"')
      .header("Cache-Control", "private, max-age=300")
      .header("X-Robots-Tag", "noindex")
      .send(body);
  });
}
