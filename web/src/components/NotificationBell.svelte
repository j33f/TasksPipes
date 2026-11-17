<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app } from "../lib/app.svelte";
  import { inbox } from "../lib/inbox.svelte";
  import { t, tn } from "../lib/i18n.svelte";

  let { onopen }: { onopen?: () => void } = $props();
</script>

<button class="btn ghost icon bell" onclick={() => { app.dialog = "inbox"; onopen?.(); }}
  title={t("Notifications")}
  aria-label={inbox.unread ? tn(inbox.unread, "Notifications, {n} unread", "Notifications, {n} unread") : t("Notifications")}>
  <Icon name="bell" />
  {#if inbox.unread}
    {#key inbox.arrivals}<span class="pastille" class:pulse={inbox.arrivals > 0}>{inbox.unread > 99 ? "99+" : inbox.unread}</span>{/key}
  {/if}
</button>

<style>
  .bell { position: relative; }
</style>
