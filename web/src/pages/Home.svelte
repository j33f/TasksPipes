<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Invitation, Task } from "../lib/types";
  import Avatar from "../components/Avatar.svelte";
  import TaskRow from "../components/TaskRow.svelte";
  import SpaceIcon from "../components/SpaceIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import NewTaskModal from "../components/NewTaskModal.svelte";
  import { t, tn } from "../lib/i18n.svelte";

  let data = $state<{ assigned: Task[]; sent: Task[]; due: Task[] } | null>(null);
  // Requests to connect waiting for my answer.
  let requests = $state<Invitation[]>([]);
  $effect(() => {
    app.version;
    api.get<Invitation[]>("/invitations").then((r) => (requests = r.filter((i) => !i.invitedByMe && i.status === "pending"))).catch(() => {});
  });

  async function answer(i: Invitation, accept: boolean) {
    try {
      await api.post(`/invitations/${i.id}/${accept ? "accept" : "refuse"}`);
      app.toast(accept ? t("You are now connected with {name}", { name: i.name }) : t("Request refused"));
      app.refresh();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }
  let creating = $state(false);

  $effect(() => {
    app.version;
    api.get<{ assigned: Task[]; sent: Task[]; due: Task[] }>("/home").then((d) => (data = d));
  });

  const hour = new Date().getHours();
  const greeting = $derived(hour < 18 ? t("Hello") : t("Good evening"));
</script>

<div class="page">
  <div class="page-header">
    <div class="grow">
      <h1>{greeting} {app.me?.user.name.split(" ")[0]}</h1>
      <div class="subtitle">{t("Your tasks, your pipes and other people's.")}</div>
    </div>
    <button class="btn" onclick={() => (creating = true)}><Icon name="plus" size={18} />{t("New task")}</button>
  </div>

  {#each requests as r (r.id)}
    <div class="callout info request">
      <Avatar user={r} size={24} />
      <span class="grow">{t("{name} wants to connect with you, to share tasks.", { name: r.name })}</span>
      <button class="btn small" onclick={() => answer(r, true)}>{t("Accept")}</button>
      <button class="btn ghost small" onclick={() => answer(r, false)}>{t("Refuse")}</button>
    </div>
  {/each}

  {#if app.isGuest && !app.me?.user.totp}
    <button class="callout warning secure" onclick={() => (app.accountOpen = true)}>
      <Icon name="shield" />
      <span>{t("Secure your account: turn on two-factor authentication (Google Authenticator) besides the e-mail link.")}</span>
    </button>
  {/if}

  {#if app.personalSpace?.incomingCount}
    <a class="callout info incoming" href={`/spaces/${app.me?.personalSpaceId}?tab=incoming`}>
      <Icon name="inbox" />
      <span>{tn(app.personalSpace.incomingCount, "{n} task waiting in your incoming.", "{n} tasks waiting in your incoming.")}</span>
    </a>
  {/if}
  {#each app.myTeams.filter((x) => x.incomingCount) as x (x.id)}
    <a class="callout incoming" href={`/spaces/${x.id}?tab=incoming`}>
      <SpaceIcon space={x} size={20} />
      <span>{t("{n} waiting in the incoming of {name}.", { n: x.incomingCount ?? 0, name: x.name })}</span>
    </a>
  {/each}

  {#if data}
    {#if data.due.length}
      <div class="section">
        <div class="section-title"><Icon name="calendar" />{t("Due in the next 7 days")}</div>
        <div class="list">{#each data.due as x (x.id)}<TaskRow task={x} />{/each}</div>
      </div>
    {/if}

    <div class="section">
      <div class="section-title">
        <Icon name="checklist" />{t("My tasks")}
        <span class="spacer"></span>
        <a class="btn ghost small" href="/next"><Icon name="target" size={16} />{t("Next action")}</a>
        <a class="btn ghost small" href="/tasks">{t("See all")}</a>
      </div>
      {#if data.assigned.length}
        <div class="list">{#each data.assigned as x (x.id)}<TaskRow task={x} />{/each}</div>
      {:else}
        <div class="empty">{t("No open task in your name.")}</div>
      {/if}
    </div>

    <div class="section">
      <div class="section-title"><Icon name="send" />{t("Sent, waiting for an answer")}</div>
      {#if data.sent.length}
        <div class="list">{#each data.sent as x (x.id)}<TaskRow task={x} />{/each}</div>
      {:else}
        <div class="empty">{t("No sent task waiting.")}</div>
      {/if}
    </div>
  {/if}

  <div class="section">
    <div class="section-title"><Icon name="users" />{t("My teams")}</div>
    <div class="grid">
      {#each app.myTeams as x (x.id)}
        <a class="card row" href={`/spaces/${x.id}`}>
          <SpaceIcon space={x} size={32} />
          <div>
            <strong>{x.name}</strong>
            <div class="muted small">{tn(x.memberCount, "{n} member", "{n} members")} · {tn(x.pipeCount, "{n} pipe", "{n} pipes")}</div>
          </div>
        </a>
      {:else}
        <div class="empty">{t("You are not in any team. Create one from the sidebar.")}</div>
      {/each}
    </div>
  </div>
</div>

{#if creating}<NewTaskModal onclose={() => (creating = false)} />{/if}

<style>
  .incoming { color: var(--text); align-items: center; }
  .request { align-items: center; }
  .request .grow { flex: 1; }
  .secure { width: 100%; border: 0; font: inherit; font-size: 14px; color: var(--text); text-align: left; cursor: pointer; align-items: center; }
  .incoming:hover { text-decoration: none; filter: brightness(0.98); }
</style>
