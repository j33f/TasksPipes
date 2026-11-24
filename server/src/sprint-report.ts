/**
 * The report of a sprint just closed, e-mailed to the members of its space when the pipe's settings ask for it
 * (SprintSettings.sendReport): its goal, points committed and done, tasks carried over, scope added, what each one
 * did, and the velocity it leads to. The burndown itself stays in the app.
 */
import type { Row } from "./db.js";
import { config } from "./config.js";
import { intlTag, localize, tr, type Locale } from "./i18n.js";
import { escape, mailLayout, mailStyle, sendHtmlMail, type MailTheme } from "./mail.js";
import { taskTypeById } from "./pipeTypes.js";
import { recipients } from "./reports.js";

interface Report {
  committed: number;
  completed: number;
  done: number;
  carried: number;
  carriedPoints: number;
  abandoned: number;
  carriedTo: { name: string } | null;
  scopeStart?: number;
  scopeEnd?: number;
  byOwner?: { key: string; done: number; donePoints: number; tasks: number; points: number }[];
  byType?: { key: string; done: number; donePoints: number; tasks: number; points: number }[];
  velocity?: { value: number | null; source: string };
}

const day = (d: string, lang: Locale) =>
  new Intl.DateTimeFormat(intlTag(lang), { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** The e-mail of a closed sprint, in `lang`. */
export function sprintEmail(pipe: Row, sprint: Row, lang: Locale, theme: MailTheme = null) {
  const st = mailStyle(theme);
  const r = (sprint.report ?? {}) as Report;
  const title = tr(lang, "{sprint} of {pipe} is closed", { sprint: sprint.name, pipe: pipe.name });
  const pts = (n: number) => tr(lang, "{n} pts", { n });
  const cell = (s: string, right: boolean, role: "text" | "muted") =>
    `<td ${st.attr("border", `padding:6px 12px 6px 0;${right ? "text-align:right;" : ""}border-bottom:1px solid`)}><span ${st.attr(role)}>${s}</span></td>`;
  const rows: [string, string][] = [
    [tr(lang, "Committed"), pts(r.committed ?? 0)],
    [tr(lang, "Done"), `${pts(r.completed ?? 0)} · ${tr(lang, "{n} tasks", { n: r.done ?? 0 })}`],
    [tr(lang, "Carried over"), `${pts(r.carriedPoints ?? 0)} · ${tr(lang, "{n} tasks", { n: r.carried ?? 0 })}${r.carriedTo ? ` → ${escape(r.carriedTo.name)}` : ""}`],
  ];
  if (r.scopeStart !== undefined && r.scopeEnd !== undefined && r.scopeEnd !== r.scopeStart) {
    rows.push([tr(lang, "Added during the sprint"), pts(r.scopeEnd - r.scopeStart)]);
  }
  if (r.velocity?.value !== null && r.velocity?.value !== undefined) rows.push([tr(lang, "Velocity for the next sprints"), pts(r.velocity.value)]);
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-top:12px">`
    + rows.map(([k, v]) => `<tr>${cell(escape(k), false, "muted")}${cell(v, true, "text")}</tr>`).join("") + `</table>`;
  const goal = sprint.goal ? st.heading(tr(lang, "Sprint goal")) + `<p style="margin:0">${escape(sprint.goal)}</p>` : "";
  const people = r.byOwner?.length
    ? st.heading(tr(lang, "Done per person"))
      + st.list(r.byOwner.map((o) => `${escape(o.key || tr(lang, "Unassigned"))} ${st.muted(`· ${pts(o.donePoints)} · ${tr(lang, "{done} of {total} tasks", { done: o.done, total: o.tasks })}`)}`))
    : "";
  const types = r.byType?.length
    ? st.heading(tr(lang, "Done per task type"))
      + st.list(r.byType.map((o) => `${escape(localize(lang, taskTypeById(o.key)?.label ?? o.key))} ${st.muted(`· ${pts(o.donePoints)} · ${tr(lang, "{done} of {total} tasks", { done: o.done, total: o.tasks })}`)}`))
    : "";
  return {
    subject: title,
    html: mailLayout(lang, {
      title,
      intro: tr(lang, "From {start} to {end}.", { start: day(String(sprint.starts_on).slice(0, 10), lang), end: day(String(sprint.ends_on).slice(0, 10), lang) }),
      body: goal + table + people + types,
      theme,
      action: { label: tr(lang, "Open the pipe"), url: `${config.appUrl}/pipes/${pipe.id}` },
      footer: escape(tr(lang, "You receive this e-mail because the pipe sends its sprint reports to the members of its space.")),
    }),
  };
}

/** Sends it to the members of the pipe's space; how many went out. */
export async function sendSprintReport(pipe: Row, sprint: Row, send = sendHtmlMail): Promise<number> {
  let sent = 0;
  for (const r of await recipients(pipe.space_id)) {
    const lang = r.locale ?? config.defaultLocale;
    const mail = sprintEmail(pipe, sprint, lang, r.theme ?? null);
    await send(lang, r.email, mail.subject, mail.html).then(() => sent++, () => {});
  }
  return sent;
}
