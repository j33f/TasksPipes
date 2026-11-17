<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "./Modal.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/app.svelte";
  import { errorMessage } from "../lib/api";
  import { inbox } from "../lib/inbox.svelte";
  import { highlightTask } from "../lib/highlight";
  import { navigate } from "../lib/router.svelte";
  import { relativeTime } from "../lib/constants";
  import type { InboxItem } from "../lib/types";
  import { t, tn } from "../lib/i18n.svelte";

  let { onclose }: { onclose: () => void } = $props();

  onMount(() => {
    inbox.load();
  });

  /** What happened, in a sentence. */
  function sentence(i: InboxItem): string {
    const name = i.actor?.name ?? t("Someone");
    switch (i.kind) {
      case "created":
        return t("{name} added a task to {pipe}", { name, pipe: i.task.pipe?.name ?? i.task.space.name });
      case "assigned":
        return t("{name} made you the owner of a task", { name });
      case "comment":
        return t("{name} commented on a task", { name });
      case "mention":
        return t("{name} mentioned you", { name });
      case "received":
        return i.task.space.kind === "team"
          ? t("{name} sent a task to {team}", { name, team: i.task.space.name })
          : t("{name} sent you a task", { name });
      case "refused":
        return t("{name} refused a task", { name });
      case "unblocked":
        return t("A task is no longer blocked");
    }
  }

  const where = (i: InboxItem) => (i.task.pipe ? `${i.task.space.name} › ${i.task.pipe.name}` : t("Incoming of {space}", { space: i.task.space.name }));

  function markRead(ids?: number[]) {
    inbox.markRead(ids).catch((err) => app.toast(errorMessage(err), "error"));
  }

  /** Goes to the task's pipe (or incoming), scrolled to the task shown in yellow; the notification is then read. */
  function open(i: InboxItem) {
    markRead([i.id]);
    onclose();
    navigate(i.task.pipe ? `/pipes/${i.task.pipe.id}` : `/spaces/${i.task.space.id}?tab=incoming`);
    highlightTask(i.task.id);
  }

  // Swiping a notification aside (touch screens) marks it as read.
  const SWIPE_SHARE = 0.35;
  let drag = $state<{ id: number; x0: number; y0: number; dx: number; swiping: boolean } | null>(null);
  let leaving = $state<{ id: number; dir: number } | null>(null);
  /** A swipe ends with a click on what was under the finger: that click is ignored. */
  let swallowClick = false;

  function pointerdown(e: PointerEvent, i: InboxItem) {
    if (e.pointerType === "mouse" || leaving) return;
    drag = { id: i.id, x0: e.clientX, y0: e.clientY, dx: 0, swiping: false };
  }

  function pointermove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.swiping) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return (drag = null); // scrolling the list
      if (Math.abs(dx) < 10) return;
      drag.swiping = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    drag.dx = dx;
  }

  function pointerup(e: PointerEvent, i: InboxItem) {
    if (!drag) return;
    const { swiping, dx } = drag;
    drag = null;
    if (!swiping) return;
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 400);
    const width = (e.currentTarget as HTMLElement).offsetWidth || 1;
    if (Math.abs(dx) < width * SWIPE_SHARE) return;
    leaving = { id: i.id, dir: Math.sign(dx) };
    setTimeout(() => {
      leaving = null;
      markRead([i.id]);
    }, 180);
  }

  function offset(i: InboxItem): string {
    if (leaving?.id === i.id) return `transform:translateX(${leaving.dir * 110}%);opacity:0;transition:transform 180ms ease-in, opacity 180ms ease-in`;
    if (drag?.id === i.id && drag.swiping) return `transform:translateX(${drag.dx}px);opacity:${Math.max(0.3, 1 - Math.abs(drag.dx) / 400)};transition:none`;
    return "";
  }

  function click(i: InboxItem) {
    if (swallowClick) return;
    open(i);
  }
</script>

<Modal title={t("Notifications")} {onclose}>
  <div class="inbox-head">
    <span class="muted small">
      {inbox.unread ? tn(inbox.unread, "{n} unread notification", "{n} unread notifications") : t("Nothing new")}
    </span>
    <button class="btn small neutral" disabled={!inbox.items.length} onclick={() => markRead()}>
      <Icon name="check" size={16} />{t("Mark all as read")}
    </button>
  </div>

  {#if !inbox.loaded}
    <div class="empty">{t("Loading…")}</div>
  {:else if inbox.items.length}
    <p class="muted small swipe-hint">{t("Swipe a notification aside to mark it as read.")}</p>
    <ul class="inbox-list">
      {#each inbox.items as i (i.id)}
        <li class="inbox-item" style={offset(i)}
          onpointerdown={(e) => pointerdown(e, i)} onpointermove={pointermove}
          onpointerup={(e) => pointerup(e, i)} onpointercancel={() => (drag = null)}>
          <button class="inbox-open" onclick={() => click(i)}>
            <Avatar user={i.actor} size={32} />
            <span class="body">
              <span class="what">{sentence(i)}</span>
              <span class="title">#{i.task.number} {i.task.title}</span>
              {#if i.excerpt}<span class="excerpt">“{i.excerpt}”</span>{/if}
              <span class="muted small">{where(i)} · {relativeTime(i.createdAt)}</span>
            </span>
          </button>
          <button class="btn ghost icon small read" title={t("Mark as read")} aria-label={t("Mark as read")}
            onclick={() => markRead([i.id])}>
            <Icon name="check" size={18} />
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="empty">{t("You are all caught up.")}</div>
  {/if}
</Modal>

<style>
  .inbox-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .inbox-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: min(65vh, 560px); overflow-y: auto; overflow-x: hidden; }
  .inbox-item {
    display: flex; align-items: flex-start; gap: 4px; border: 1px solid var(--divider); border-radius: 8px;
    background: var(--background); touch-action: pan-y; transition: transform 150ms ease, opacity 150ms ease;
  }
  .inbox-open {
    flex: 1; min-width: 0; display: flex; gap: 10px; align-items: flex-start; text-align: left;
    background: none; border: 0; padding: 10px 4px 10px 10px; color: inherit; font: inherit; cursor: pointer; border-radius: 8px;
  }
  .inbox-open:hover { background: var(--sidebar-hover, rgb(0 0 0 / 4%)); }
  .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .what { font-size: 14px; }
  .title { font-weight: 600; overflow-wrap: anywhere; }
  .excerpt { font-size: 13px; color: var(--text-secondary, inherit); overflow-wrap: anywhere; }
  .read { margin: 8px 8px 0 0; }
  .swipe-hint { display: none; margin: 0 0 8px; }
  @media (hover: none) { .swipe-hint { display: block; } }
</style>
