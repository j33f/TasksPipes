<script lang="ts">
  import { formatWork } from "../lib/worklog";
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDuration } from "../lib/constants";
  import { intlLocale, t } from "../lib/i18n.svelte";
  import type { DailyReport, Pipe, ReportTask, WeeklyReport } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";

  /** Daily activity and weekly time reports of a pipe, and their sending by e-mail. */
  let { pipe, onclose }: { pipe: Pipe & { canManage: boolean }; onclose: () => void } = $props();

  const timeReport = $derived(Boolean(app.pipeType(pipe.kind)?.timeReport));
  let tab = $state<"daily" | "weekly">("daily");
  let day = $state("");
  let daily = $state<DailyReport | null>(null);
  let weekly = $state<WeeklyReport | null>(null);
  let error = $state("");
  // The boxes start from the pipe's settings, then follow the clicks.
  let sendDaily = $state(untrack(() => pipe.dailyReport));
  let sendWeekly = $state(untrack(() => pipe.weeklyReport));

  async function load() {
    error = "";
    const qs = day ? `?date=${day}` : "";
    try {
      if (tab === "daily") {
        daily = await api.get<DailyReport>(`/pipes/${pipe.id}/reports/daily${qs}`);
        day = daily.day;
      } else {
        weekly = await api.get<WeeklyReport>(`/pipes/${pipe.id}/reports/weekly${qs}`);
        day = weekly.day;
      }
    } catch (err) {
      error = errorMessage(err);
    }
  }
  $effect(() => {
    tab;
    load();
  });

  async function setSending(next: { dailyReport?: boolean; weeklyReport?: boolean }) {
    try {
      await api.patch(`/pipes/${pipe.id}`, next);
      app.refresh();
      app.toast(t("Saved"));
    } catch (err) {
      error = errorMessage(err);
    }
  }

  const when = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const typeLabel = (id: string) => app.taskType(id)?.label ?? id;
  const sections = $derived(daily ? ([
    [t("New in the pipe"), daily.created], [t("Tasks started"), daily.started], [t("Tasks done"), daily.done],
    [t("Tasks blocked"), daily.blocked], [t("Tasks dropped"), daily.dropped], [t("Still in progress"), daily.inProgress],
    [t("Still blocked"), daily.stillBlocked],
  ] as [string, ReportTask[]][]) : []);
</script>

{#snippet taskLink(task: ReportTask, extra?: string)}
  <li>
    <a href={`/pipes/${pipe.id}?task=${task.id}`} onclick={onclose}>TP-{task.number}</a> {task.title}
    <span class="muted small">{task.stage ? ` · ${task.stage}` : ""}{task.owner ? ` · ${task.owner}` : ""}{extra ? ` · ${extra}` : ""}</span>
  </li>
{/snippet}

<Modal large title={t("Reports · {pipe}", { pipe: pipe.name })} {onclose}>
  {#if timeReport}
    <div class="tabs">
      <button class:active={tab === "daily"} onclick={() => { tab = "daily"; day = ""; }}>{t("Daily activity")}</button>
      <button class:active={tab === "weekly"} onclick={() => { tab = "weekly"; day = ""; }}>{t("Weekly time")}</button>
    </div>
  {/if}

  <div class="row wrap toolbar">
    <label class="row">
      <span class="small muted">{tab === "daily" ? t("Day") : t("Week ending on Friday")}</span>
      <input class="input date" type="date" bind:value={day} onchange={load} />
    </label>
    {#if tab === "daily" && daily}
      <span class="small muted">{t("From {start} to {end}", { start: when(daily.period.start), end: when(daily.period.end) })}</span>
    {:else if weekly}
      <span class="small muted">{t("From {start} to {end}", { start: when(weekly.period.start), end: when(weekly.period.end) })}</span>
    {/if}
  </div>

  {#if error}<div class="error-text">{error}</div>{/if}

  {#if tab === "daily" && daily}
    {#if sections.every(([, list]) => !list.length)}
      <div class="empty">{t("Nothing happened in this pipe during this period.")}</div>
    {/if}
    {#each sections.filter(([, list]) => list.length) as [title, list] (title)}
      <div class="section">
        <div class="section-title">{title}<span class="count neutral">{list.length}</span></div>
        <ul>{#each list as task (task.id)}{@render taskLink(task)}{/each}</ul>
      </div>
    {/each}
  {:else if tab === "weekly" && weekly}
    <p class="small">{t("Time spent on tasks being worked on (in progress columns): {total}.", { total: formatDuration(weekly.totalActiveMs) })}</p>
    {#if weekly.byType.length}
      <table>
        <thead><tr><th>{t("Task type")}</th><th>{t("In progress")}</th><th>{t("Blocked")}</th><th>{t("Tasks")}</th><th>{t("Done")}</th></tr></thead>
        <tbody>
          {#each weekly.byType as row (row.taskType)}
            <tr><td>{typeLabel(row.taskType)}</td><td>{formatDuration(row.activeMs)}</td><td>{formatDuration(row.blockedMs)}</td><td>{row.tasks}</td><td>{row.done}</td></tr>
          {/each}
        </tbody>
      </table>
      <div class="section">
        <div class="section-title">{t("Tasks that took the most time")}</div>
        <ul>{#each weekly.tasks as task (task.id)}{@render taskLink(task, formatDuration(task.activeMs))}{/each}</ul>
      </div>
    {:else}
      <div class="empty">{t("No time recorded this week.")}</div>
    {/if}
    {#if weekly.logged?.totalMinutes}
      <div class="section">
        <div class="section-title">{t("Time logged: {total}", { total: formatWork(weekly.logged.totalMinutes) })}</div>
        <p class="small">{weekly.logged.byPerson.map((p) => `${p.name} ${formatWork(p.minutes)}`).join(" · ")}</p>
        <ul>
          {#each weekly.logged.tasks as task (task.id)}
            {@render taskLink(task, formatWork(task.minutes) + (task.estimateMinutes
              ? ` · ${t("{logged} of {estimate} estimated", { logged: formatWork(task.totalMinutes), estimate: formatWork(task.estimateMinutes) })}` : ""))}
          {/each}
        </ul>
      </div>
    {/if}
  {/if}

  {#if pipe.canManage}
    <div class="sending">
      <div class="section-title"><Icon name="mail" />{t("By e-mail")}</div>
      <label class="check"><input type="checkbox" bind:checked={sendDaily} onchange={() => setSending({ dailyReport: sendDaily })} />
        {t("Send the daily activity to the members of the space every day at {hour}:00", { hour: daily?.hour ?? weekly?.hour ?? 18 })}</label>
      {#if timeReport}
        <label class="check"><input type="checkbox" bind:checked={sendWeekly} onchange={() => setSending({ weeklyReport: sendWeekly })} />
          {t("Send the weekly time report every Friday at {hour}:00", { hour: daily?.hour ?? weekly?.hour ?? 18 })}</label>
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--divider); margin-bottom: 12px; }
  .tabs button { border: 0; background: none; font: inherit; font-size: 14px; font-weight: 500; color: var(--text-tertiary); padding: 8px 12px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tabs button.active { color: var(--text); border-bottom-color: var(--text); }
  .toolbar { gap: 12px; margin-bottom: 12px; }
  .toolbar label { gap: 8px; }
  .date { width: auto; min-height: 32px; padding: 4px 8px; font-size: 14px; }
  .section { margin-top: 16px; }
  ul { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-weight: 500; color: var(--text-tertiary); font-size: 12px; }
  th, td { padding: 6px 8px 6px 0; border-bottom: 1px solid var(--divider); }
  th:not(:first-child), td:not(:first-child) { text-align: right; }
  .sending { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--divider); }
  .check { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; margin: 6px 0; }
</style>
