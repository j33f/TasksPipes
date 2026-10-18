<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatDate } from "../lib/constants";
  import { describeRule, weekdayName } from "../lib/recurrence";
  import type { Recurrence, TaskDetail } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  let { task, onchange }: { task: TaskDetail; onchange: () => void } = $props();

  const r = $derived(task.recurrence?.active ? task.recurrence : null);
  const canEdit = $derived(task.permissions.manage && Boolean(task.pipe));
  // The first date: the series' start, else the task's due date (else today, on the server).
  const startDay = $derived(r?.startsOn ?? task.dueDate ?? new Date().toISOString().slice(0, 10));

  let editing = $state(false);
  let freq = $state<Recurrence["rule"]["freq"]>("weekly");
  let interval = $state(1);
  let weekdays = $state<number[]>([]);
  let monthlyKind = $state<"day" | "weekday" | "lastBusinessDay">("day");
  let monthDay = $state(1);
  let nth = $state<1 | 2 | 3 | 4 | -1>(1);
  let nthWeekday = $state(1);
  let mode = $state<Recurrence["mode"]>("schedule");
  let leadDays = $state(0);
  let endsOn = $state("");
  let error = $state("");
  let busy = $state(false);

  /** The form starts from the series, or from the task's date. */
  function edit() {
    const rule = r?.rule;
    const d = new Date(`${startDay}T00:00:00Z`);
    const wd = ((d.getUTCDay() + 6) % 7) + 1;
    freq = rule?.freq ?? "weekly";
    interval = rule?.interval ?? 1;
    weekdays = rule?.weekdays ?? [wd];
    const m = rule?.monthly;
    monthlyKind = m?.kind ?? "day";
    monthDay = m?.kind === "day" ? m.day : d.getUTCDate();
    nth = m?.kind === "weekday" ? m.nth : (Math.min(4, Math.ceil(d.getUTCDate() / 7)) as 1 | 2 | 3 | 4);
    nthWeekday = m?.kind === "weekday" ? m.weekday : wd;
    mode = r?.mode ?? "schedule";
    leadDays = r?.leadDays ?? 0;
    endsOn = r?.endsOn ?? "";
    error = "";
    editing = true;
  }

  const rule = () => ({
    freq, interval,
    ...(freq === "weekly" ? { weekdays } : {}),
    ...(freq === "monthly"
      ? { monthly: monthlyKind === "day" ? { kind: "day", day: monthDay } : monthlyKind === "weekday" ? { kind: "weekday", nth, weekday: nthWeekday } : { kind: "lastBusinessDay" } }
      : {}),
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.put(`/tasks/${task.id}/recurrence`, { rule: rule(), mode, leadDays: mode === "schedule" ? leadDays : 0, endsOn: endsOn || null });
      editing = false;
      onchange();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function stop() {
    if (!confirm(t("Stop repeating this task? The tasks already made stay."))) return;
    await api.del(`/tasks/${task.id}/recurrence`).then(onchange).catch((err) => (error = errorMessage(err)));
  }

  const toggleDay = (d: number) => (weekdays = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort());
</script>

<div class="prop">
  <span class="label-text">{t("Repeat")}</span>
  {#if editing}
    <form class="repeat" onsubmit={save}>
      <div class="row">
        <span>{t("Every")}</span>
        <input class="input num" type="number" min="1" max="99" bind:value={interval} aria-label={t("Every")} />
        <select class="input" bind:value={freq} aria-label={t("Frequency")}>
          <option value="daily">{t("day(s)")}</option>
          <option value="weekly">{t("week(s)")}</option>
          <option value="monthly">{t("month(s)")}</option>
          <option value="yearly">{t("year(s)")}</option>
        </select>
      </div>
      {#if freq === "weekly"}
        <div class="row days">
          {#each [1, 2, 3, 4, 5, 6, 7] as d (d)}
            <label class="day"><input type="checkbox" checked={weekdays.includes(d)} onchange={() => toggleDay(d)} />{weekdayName(d, "short")}</label>
          {/each}
        </div>
      {:else if freq === "monthly"}
        <label class="row"><input type="radio" bind:group={monthlyKind} value="day" />{t("On day")}
          <input class="input num" type="number" min="1" max="31" bind:value={monthDay} aria-label={t("On day")} /></label>
        <label class="row"><input type="radio" bind:group={monthlyKind} value="weekday" />{t("On the")}
          <select class="input" bind:value={nth} aria-label={t("Which one")}>
            <option value={1}>{t("first")}</option><option value={2}>{t("second")}</option><option value={3}>{t("third")}</option>
            <option value={4}>{t("fourth")}</option><option value={-1}>{t("last")}</option>
          </select>
          <select class="input" bind:value={nthWeekday} aria-label={t("Day of the week")}>
            {#each [1, 2, 3, 4, 5, 6, 7] as d (d)}<option value={d}>{weekdayName(d)}</option>{/each}
          </select>
        </label>
        <label class="row"><input type="radio" bind:group={monthlyKind} value="lastBusinessDay" />{t("On the last business day")}</label>
      {/if}
      <label class="row"><input type="radio" bind:group={mode} value="schedule" />{t("At these dates, made")}
        <input class="input num" type="number" min="0" max="90" bind:value={leadDays} disabled={mode !== "schedule"} aria-label={t("Days ahead")} />
        {t("days ahead")}</label>
      <label class="row"><input type="radio" bind:group={mode} value="after_done" />{t("Once the previous one is done")}</label>
      <label class="row">{t("Until")} <input class="input" type="date" bind:value={endsOn} aria-label={t("Until")} /> <span class="muted small">{t("(optional)")}</span></label>
      {#if error}<p class="error-text">{error}</p>{/if}
      <div class="row">
        <button class="btn small" disabled={busy || (freq === "weekly" && !weekdays.length)}>{t("Save")}</button>
        <button type="button" class="btn ghost small" onclick={() => (editing = false)}>{t("Cancel")}</button>
      </div>
    </form>
  {:else if r}
    <div class="value summary">
      <span>{describeRule(r.rule, r.startsOn)}{r.mode === "after_done" ? ` · ${t("once the previous one is done")}` : ""}</span>
      {#if r.upcoming.length}<span class="muted small">{t("Next: {dates}", { dates: r.upcoming.map((d) => formatDate(d)).join(", ") })}</span>{/if}
      {#if r.endsOn}<span class="muted small">{t("until {date}", { date: formatDate(r.endsOn) })}</span>{/if}
      {#if canEdit}
        <span class="row">
          <button class="btn ghost small" onclick={edit}>{t("Change")}</button>
          <button class="btn ghost small" onclick={stop}>{t("Stop")}</button>
        </span>
      {/if}
    </div>
  {:else if canEdit}
    <button class="btn neutral small" onclick={edit}>{t("Repeat…")}</button>
  {:else}
    <div class="value muted">—</div>
  {/if}
</div>

<style>
  .repeat { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .num { width: 64px; }
  .repeat .input { min-height: 28px; padding: 2px 6px; font-size: 14px; width: auto; }
  .days { gap: 4px; }
  .day { display: inline-flex; gap: 2px; align-items: center; font-size: 13px; }
  .summary { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
</style>
