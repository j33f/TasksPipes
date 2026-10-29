<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/app.svelte";
  import { errorMessage } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { currentSubscription, enablePush, pushSupported } from "../lib/push";

  // Asks once per device for push notifications, while the browser has not been asked yet; "Not now" asks again a
  // month later. The browser's prompt only opens from a click.
  const DISMISSED = "tp:pushPromptDismissed";
  const AGAIN_MS = 30 * 24 * 3600_000;

  let show = $state(false);
  let busy = $state(false);

  onMount(async () => {
    if (!pushSupported() || Notification.permission !== "default") return;
    try {
      if (Date.now() - Number(localStorage.getItem(DISMISSED) || 0) < AGAIN_MS) return;
    } catch { /* storage unavailable */ }
    show = !(await currentSubscription().catch(() => null));
  });

  async function enable() {
    busy = true;
    try {
      if (!(await enablePush())) app.toast(t("Notifications are blocked for this site in the browser."), "error");
      show = false;
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  }

  function later() {
    try { localStorage.setItem(DISMISSED, String(Date.now())); } catch { /* storage unavailable */ }
    show = false;
  }
</script>

{#if show}
  <div class="update-bar" role="status">
    <span>{t("Get a notification on this device when something needs you?")}</span>
    <button class="btn small" disabled={busy} onclick={enable}>{t("Turn on notifications")}</button>
    <button class="btn ghost small" onclick={later}>{t("Not now")}</button>
  </div>
{/if}
