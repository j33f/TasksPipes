<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import Modal from "./Modal.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let error = $state("");

  // Calendar subscription link (made on first display).
  let calendar = $state<string | null>(null);
  api.get<{ url: string }>("/me/calendar").then((r) => (calendar = r.url)).catch(() => {});
  const webcal = $derived(calendar?.replace(/^https?:/, "webcal:") ?? "");
  const googleUrl = $derived(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`);

  async function copyCalendar() {
    try {
      await navigator.clipboard.writeText(calendar!);
      app.toast(t("Link copied"));
    } catch {
      app.toast(t("Could not copy: select the link"), "error");
    }
  }

  async function resetCalendar() {
    if (!confirm(t("Make a new link? Calendars subscribed with the current one will stop showing your tasks."))) return;
    try {
      calendar = (await api.post<{ url: string }>("/me/calendar/reset")).url;
      app.toast(t("New calendar link made"));
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<Modal title={t("Calendar")} {onclose}>
  <p class="small">{t("Subscribe to your tasks with a due date in Google Calendar, Apple Calendar or any calendar app. The link is personal: keep it to yourself.")}</p>
  {#if calendar}
    <div class="row">
      <input class="input cal-url" readonly value={calendar} aria-label={t("Calendar link")}
        onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
      <button class="btn neutral small" onclick={copyCalendar}>{t("Copy")}</button>
    </div>
    <div class="row wrap cal-actions">
      <a class="btn small" href={googleUrl} target="_blank" rel="noreferrer">{t("Add to Google Calendar")}</a>
      <a class="btn small neutral" href={webcal}>{t("Add to Apple Calendar")}</a>
      <span class="spacer"></span>
      <button class="btn ghost small" onclick={resetCalendar}>{t("New link…")}</button>
    </div>
    <p class="hint">{t("Calendars refresh at their own pace: within the hour for Apple, up to a day for Google.")}</p>
  {/if}
  {#if error}<div class="error-text">{error}</div>{/if}
</Modal>

<style>
  .cal-url { font-size: 13px; min-height: 30px; padding: 4px 8px; }
  .cal-actions { margin-top: 8px; }
</style>
