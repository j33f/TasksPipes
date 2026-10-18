<script lang="ts">
  import { t, tn } from "../lib/i18n.svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { navigate, router, setParams } from "../lib/router.svelte";
  import { STATUSES, formatDate, relativeTime } from "../lib/constants";
  import type { SpaceDetail, Task } from "../lib/types";
  import SpaceIcon from "../components/SpaceIcon.svelte";
  import Avatar from "../components/Avatar.svelte";
  import Icon from "../components/Icon.svelte";
  import Markdown from "../components/Markdown.svelte";
  import PipeModal from "../components/PipeModal.svelte";
  import PipeIcon from "../components/PipeIcon.svelte";
  import TeamModal from "../components/TeamModal.svelte";
  import NewTaskModal from "../components/NewTaskModal.svelte";
  import AcceptDialog from "../components/AcceptDialog.svelte";
  import RefuseDialog from "../components/RefuseDialog.svelte";
  import { awaitingSignIn, inviteColleague } from "../lib/people";

  let { id }: { id: string } = $props();

  let space = $state<SpaceDetail | null>(null);
  let error = $state("");
  let showSettings = $state(false);
  let showNewTask = $state(false);
  let accepting = $state<Task | null>(null);
  let refusing = $state<Task | null>(null);
  let showArchived = $state(false);

  $effect(() => {
    app.version;
    api.get<SpaceDetail>(`/spaces/${id}`).then((s) => (space = s)).catch((err) => (error = errorMessage(err)));
  });

  const isMember = $derived(Boolean(space?.myRole));
  const isMine = $derived(id === app.me?.personalSpaceId);
  const isAdminOfTeam = $derived(space?.kind === "team" && space.myRole === "admin");
  const tab = $derived(isMember && router.params.get("tab") === "incoming" ? "incoming" : "pipes");
  const showNewPipe = $derived(router.params.get("newPipe") === "1");
  const meId = $derived(app.me?.user.id);
  const activePipes = $derived(space?.pipes.filter((p) => !p.archived) ?? []);
  // An Outline colleague who never signed in: invited rather than sent tasks.
  const waiting = $derived(app.spaces.find((s) => s.id === id && s.kind === "user" && s.userId && awaitingSignIn(s)) ?? null);
  const archivedPipes = $derived(space?.pipes.filter((p) => p.archived) ?? []);

  async function leave() {
    if (!space || !confirm(t("Leave the team “{name}”?", { name: space.name }))) return;
    try {
      await api.del(`/spaces/${space.id}/members/${meId}`);
      app.refresh();
      navigate("/");
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }

  const total = (counts: Record<string, number | undefined>) => Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
</script>

{#if error}
  <div class="page"><div class="callout danger">{error}</div></div>
{:else if space}
  <div class="page">
    <div class="page-header">
      <SpaceIcon {space} size={44} />
      <div class="grow">
        <h1>
          {isMine ? t("My space") : space.name}
          <span class="badge">{space.kind === "team" ? t("Team") : t("Personal space")}</span>
        </h1>
        {#if space.kind === "team"}
          <div class="row subtitle">
            <div class="avatar-stack">{#each space.members.slice(0, 8) as m (m.id)}<Avatar user={m} size={22} />{/each}</div>
            <span>{tn(space.members.length, "{n} member", "{n} members")} · {t("admins: {names}", { names: space.members.filter((m) => m.role === "admin").map((m) => m.name).join(", ") })}</span>
          </div>
        {:else if waiting}
          <div class="subtitle">{t("{name} has not signed in to TasksPipes yet: invite them to send them tasks.", { name: space.name })}</div>
        {:else if !isMember}
          <div class="subtitle">{t("You see the open pipes of {name}. You can add tasks to them or send tasks to {name}.", { name: space.name })}</div>
        {/if}
      </div>
      <div class="row wrap actions">
        {#if waiting?.userId}
          {@const userId = waiting.userId}
          <button class="btn neutral" onclick={() => inviteColleague(userId, waiting.name)}><Icon name="send" size={18} />{t("Invite to TasksPipes")}</button>
        {:else if !isMine}
          <button class="btn neutral" onclick={() => (showNewTask = true)}><Icon name="send" size={18} />{t("Send a task")}</button>
        {/if}
        {#if isMember}
          <button class="btn" onclick={() => setParams({ newPipe: "1" })}><Icon name="plus" size={18} />{t("New pipe")}</button>
        {/if}
        {#if isAdminOfTeam}
          <button class="btn neutral icon" title={t("Settings and members")} onclick={() => (showSettings = true)}><Icon name="settings" /></button>
        {:else if space.kind === "team" && isMember}
          <button class="btn ghost" onclick={leave}>{t("Leave")}</button>
        {/if}
      </div>
    </div>

    {#if space.description}<div class="description"><Markdown source={space.description} /></div>{/if}

    {#if isMember}
      <div class="tabs">
        <button class="tab" class:active={tab === "pipes"} onclick={() => setParams({ tab: null }, { replace: true })}>
          <Icon name="pipe" size={18} />Pipes <span class="count neutral">{activePipes.length}</span>
        </button>
        <button class="tab" class:active={tab === "incoming"} onclick={() => setParams({ tab: "incoming" }, { replace: true })}>
          <Icon name="inbox" size={18} />Incoming
          {#if space.incoming?.length}<span class="count">{space.incoming.length}</span>{/if}
        </button>
      </div>
    {:else}
      <div class="section-title" style="margin-top:24px"><Icon name="globe" />{t("Open pipes")}</div>
    {/if}

    {#if tab === "pipes"}
      <div class="grid">
        {#each showArchived ? space.pipes : activePipes as p (p.id)}
          {@const n = total(p.counts)}
          <a class="card pipe-card" class:archived={p.archived} href={`/pipes/${p.id}`} style="border-top: 3px solid {p.color || 'var(--divider)'}">
            <div class="row">
              <PipeIcon pipe={p} size={20} />
              <h3>{p.name}</h3>
              <span class="spacer"></span>
              {#if p.archived}
                <span class="badge"><Icon name="archive" size={12} />{t("Archived")}</span>
              {:else if p.visibility === "open"}
                <span class="badge open"><Icon name="globe" size={12} />{t("Open")}</span>
              {:else}
                <span class="badge">{#if space.kind === "team"}<Icon name="users" size={12} />{t("Team")}{:else}<Icon name="lock" size={12} />{t("Personal")}{/if}</span>
              {/if}
            </div>
            {#if app.pipeType(p.kind)}<div class="muted small kind">{app.pipeType(p.kind)?.label}</div>{/if}
            <div class="desc">{p.description || t("No description")}</div>
            <div class="progress">
              {#each STATUSES as s (s.id)}
                {#if p.counts[s.id]}
                  <span title={`${t(s.label)}: ${p.counts[s.id]}`} style="width:{((p.counts[s.id] ?? 0) / n) * 100}%;background:{s.color}"></span>
                {/if}
              {/each}
            </div>
            <div class="muted small" style="margin-top:6px">{tn(n, "{n} task", "{n} tasks")} · {t("done: {n}", { n: p.counts.done ?? 0 })}</div>
          </a>
        {:else}
          <div class="empty">
            {#if isMember}{t("No pipe yet. Create one to organise your tasks.")}{:else}{t("No open pipe in this space.")}{/if}
          </div>
        {/each}
      </div>
      {#if archivedPipes.length}
        <button class="btn ghost small show-archived" onclick={() => (showArchived = !showArchived)}>
          <Icon name="archive" size={16} />
          {showArchived ? t("Hide archived pipes") : t("Show archived pipes ({n})", { n: archivedPipes.length })}
        </button>
      {/if}
    {:else}
      <div class="list incoming-list">
        {#each space.incoming ?? [] as item (item.id)}
          <div class="card incoming-item">
            {#if item.sender}<Avatar user={item.sender} size={32} />{/if}
            <div class="body">
              <button class="link-title" onclick={() => app.openTask(item.id)}>{item.title}</button>
              <div class="muted small">
                {#if item.sender}{item.sender.id === meId ? t("Created by you") : t("Sent by {name}", { name: item.sender.name })}{/if}
                · {relativeTime(item.updatedAt)}
                {#if item.dueDate} · {t("due {date}", { date: formatDate(item.dueDate) })}{/if}
                {#if item.commentCount} · {tn(item.commentCount, "{n} comment", "{n} comments")}{/if}
              </div>
              {#if item.description}<div class="excerpt"><Markdown source={item.description} compact /></div>{/if}
            </div>
            <div class="row actions">
              <button class="btn small" onclick={() => (accepting = item)}><Icon name="check" size={16} />{t("Accept")}</button>
              {#if item.sender && item.sender.id !== meId}
                <button class="btn small neutral" onclick={() => (refusing = item)}><Icon name="return" size={16} />{t("Refuse")}</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty">{t("The incoming is empty. Tasks sent by others will arrive here.")}</div>
        {/each}
      </div>
    {/if}
  </div>

  {#if showNewPipe && isMember}<PipeModal spaceId={space.id} onclose={() => setParams({ newPipe: null }, { replace: true })} />{/if}
  {#if showSettings}<TeamModal team={space} onclose={() => (showSettings = false)} />{/if}
  {#if showNewTask}<NewTaskModal spaceId={space.id} onclose={() => (showNewTask = false)} />{/if}
  {#if accepting}<AcceptDialog task={accepting} pipes={activePipes} onclose={() => (accepting = null)} />{/if}
  {#if refusing}<RefuseDialog task={refusing} onclose={() => (refusing = null)} />{/if}
{/if}

<style>
  .actions { flex-shrink: 0; }
  .description { margin: -8px 0 24px; color: var(--text-secondary); }
  .pipe-card h3 { font-size: 16px; }
  .pipe-card .kind { margin-top: 2px; }
  .pipe-card.archived { opacity: 0.6; }
  .show-archived { margin-top: 16px; color: var(--text-tertiary); }
  .pipe-card .desc { color: var(--text-tertiary); font-size: 14px; margin: 6px 0 12px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .progress { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--background-secondary); }
  .incoming-list { gap: 10px; }
  .incoming-item { display: flex; gap: 12px; align-items: flex-start; }
  .incoming-item .body { flex: 1; min-width: 0; }
  .link-title { font: inherit; font-weight: 600; font-size: 16px; border: 0; background: none; padding: 0; color: var(--text); cursor: pointer; text-align: left; }
  .link-title:hover { text-decoration: underline; }
  .excerpt { margin-top: 6px; max-height: 4.5em; overflow: hidden; color: var(--text-secondary); }
  @media (max-width: 700px) {
    .page-header { flex-wrap: wrap; }
    .incoming-item { flex-wrap: wrap; }
  }
</style>
