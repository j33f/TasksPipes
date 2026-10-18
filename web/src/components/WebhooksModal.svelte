<script lang="ts">
  import Modal from "./Modal.svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { relativeTime } from "../lib/constants";
  import type { Webhook } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  let { pipeId, onclose }: { pipeId: string; onclose: () => void } = $props();

  const EVENTS: { id: string; label: () => string }[] = [
    { id: "task.created", label: () => t("A task is created") },
    { id: "task.moved", label: () => t("A task changes column or pipe") },
    { id: "task.assigned", label: () => t("A task gets an owner") },
    { id: "task.commented", label: () => t("A task is commented") },
    { id: "task.done", label: () => t("A task is done") },
  ];

  let hooks = $state<Webhook[]>([]);
  let url = $state("");
  let events = $state<string[]>(["task.created", "task.done"]);
  let shown = $state<string | null>(null);
  let error = $state("");

  const load = () => api.get<Webhook[]>(`/pipes/${pipeId}/webhooks`).then((r) => (hooks = r)).catch((err) => (error = errorMessage(err)));
  load();

  async function run(fn: () => Promise<unknown>) {
    error = "";
    try {
      await fn();
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  const add = (e: SubmitEvent) => {
    e.preventDefault();
    return run(async () => {
      const h = await api.post<Webhook>(`/pipes/${pipeId}/webhooks`, { url, events });
      url = "";
      shown = h.id;
    });
  };
  const toggleEvent = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const remove = (h: Webhook) => confirm(t("Delete this webhook?")) && run(() => api.del(`/webhooks/${h.id}`));
  const ping = (h: Webhook) => run(() => api.post(`/webhooks/${h.id}/ping`)).then(() => app.toast(t("Test sent: it goes within a few seconds")));
</script>

<Modal title={t("Webhooks")} {onclose} large>
  <p class="small">{t("Task events of this pipe are sent as JSON to an https address, signed with the webhook's secret (HMAC-SHA256 of “timestamp.body”, header X-TasksPipes-Signature), and retried for about 15 hours.")}</p>
  {#each hooks as h (h.id)}
    <div class="hook">
      <div class="row">
        <code class="grow url">{h.url}</code>
        <label class="row small"><input type="checkbox" checked={h.active} onchange={() => run(() => api.patch(`/webhooks/${h.id}`, { active: !h.active }))} />{t("On")}</label>
        <button class="btn ghost small" onclick={() => ping(h)}>{t("Test")}</button>
        <button class="btn ghost small" onclick={() => remove(h)}>{t("Delete")}</button>
      </div>
      <div class="row events">
        {#each EVENTS as ev (ev.id)}
          <label class="small"><input type="checkbox" checked={h.events.includes(ev.id)}
            onchange={() => run(() => api.patch(`/webhooks/${h.id}`, { events: toggleEvent(h.events, ev.id) }))} /> {ev.label()}</label>
        {/each}
      </div>
      <div class="small">
        {t("Secret")}:
        {#if shown === h.id}<code>{h.secret}</code>{:else}<button class="btn ghost small" onclick={() => (shown = h.id)}>{t("Show")}</button>{/if}
        <button class="btn ghost small" onclick={() => run(() => api.patch(`/webhooks/${h.id}`, { newSecret: true }))}>{t("New secret")}</button>
      </div>
      {#if h.deliveries.length}
        <table>
          <thead><tr><th>{t("Event")}</th><th>{t("State")}</th><th>{t("Answer")}</th><th>{t("When")}</th></tr></thead>
          <tbody>
            {#each h.deliveries as d (d.id)}
              <tr>
                <td><code>{d.event}</code></td>
                <td>{d.state === "delivered" ? t("Delivered") : d.state === "failed" ? t("Given up") : t("Pending")}{d.attempts > 1 ? ` (${d.attempts})` : ""}</td>
                <td>{d.error ?? d.status ?? "—"}</td>
                <td class="muted">{relativeTime(d.createdAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/each}
  <form class="add" onsubmit={add}>
    <input class="input" type="url" placeholder="https://example.com/hooks/taskspipes" aria-label={t("Address")} bind:value={url} />
    <div class="row events">
      {#each EVENTS as ev (ev.id)}
        <label class="small"><input type="checkbox" checked={events.includes(ev.id)} onchange={() => (events = toggleEvent(events, ev.id))} /> {ev.label()}</label>
      {/each}
    </div>
    <button class="btn small" disabled={!url.trim() || !events.length}>{t("Add a webhook")}</button>
  </form>
  {#if error}<p class="error-text" role="alert">{error}</p>{/if}
</Modal>

<style>
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .url { word-break: break-all; }
  .hook { border-top: 1px solid var(--divider); padding: 12px 0; }
  .events { gap: 12px; margin: 6px 0; }
  .events label { display: inline-flex; gap: 4px; align-items: center; }
  .add { border-top: 1px solid var(--divider); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th { text-align: left; font-weight: 500; color: var(--text-secondary); padding: 4px 6px; border-bottom: 1px solid var(--divider); }
  td { padding: 4px 6px; border-bottom: 1px solid var(--divider); }
</style>
