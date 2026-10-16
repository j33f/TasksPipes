<script lang="ts">
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
  const archivedPipes = $derived(space?.pipes.filter((p) => p.archived) ?? []);

  async function leave() {
    if (!space || !confirm(`Quitter l'équipe « ${space.name} » ?`)) return;
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
          {isMine ? "Mon espace" : space.name}
          <span class="badge">{space.kind === "team" ? "Équipe" : "Personnel"}</span>
        </h1>
        {#if space.kind === "team"}
          <div class="row subtitle">
            <div class="avatar-stack">{#each space.members.slice(0, 8) as m (m.id)}<Avatar user={m} size={22} />{/each}</div>
            <span>{space.members.length} membre{space.members.length > 1 ? "s" : ""} · admin : {space.members.filter((m) => m.role === "admin").map((m) => m.name).join(", ")}</span>
          </div>
        {:else if !isMember}
          <div class="subtitle">Vous voyez les pipes « open » de {space.name}. Vous pouvez y ajouter des tâches ou lui en envoyer.</div>
        {/if}
      </div>
      <div class="row wrap actions">
        {#if !isMine}
          <button class="btn neutral" onclick={() => (showNewTask = true)}><Icon name="send" size={18} />Envoyer une tâche</button>
        {/if}
        {#if isMember}
          <button class="btn" onclick={() => setParams({ newPipe: "1" })}><Icon name="plus" size={18} />Nouveau pipe</button>
        {/if}
        {#if isAdminOfTeam}
          <button class="btn neutral icon" title="Paramètres et membres" onclick={() => (showSettings = true)}><Icon name="settings" /></button>
        {:else if space.kind === "team" && isMember}
          <button class="btn ghost" onclick={leave}>Quitter</button>
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
      <div class="section-title" style="margin-top:24px"><Icon name="globe" />Pipes open</div>
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
                <span class="badge"><Icon name="archive" size={12} />Archivé</span>
              {:else if p.visibility === "open"}
                <span class="badge open"><Icon name="globe" size={12} />Open</span>
              {:else}
                <span class="badge">{#if space.kind === "team"}<Icon name="users" size={12} />Équipe{:else}<Icon name="lock" size={12} />Perso{/if}</span>
              {/if}
            </div>
            {#if app.pipeType(p.kind)}<div class="muted small kind">{app.pipeType(p.kind)?.label}</div>{/if}
            <div class="desc">{p.description || "Pas de description"}</div>
            <div class="progress">
              {#each STATUSES as s (s.id)}
                {#if p.counts[s.id]}
                  <span title={`${s.label} : ${p.counts[s.id]}`} style="width:{((p.counts[s.id] ?? 0) / n) * 100}%;background:{s.color}"></span>
                {/if}
              {/each}
            </div>
            <div class="muted small" style="margin-top:6px">{n} tâche{n > 1 ? "s" : ""} · {p.counts.done ?? 0} terminée{(p.counts.done ?? 0) > 1 ? "s" : ""}</div>
          </a>
        {:else}
          <div class="empty">
            {#if isMember}Aucun pipe pour l'instant. Créez-en un pour organiser vos tâches.{:else}Aucun pipe open dans cet espace.{/if}
          </div>
        {/each}
      </div>
      {#if archivedPipes.length}
        <button class="btn ghost small show-archived" onclick={() => (showArchived = !showArchived)}>
          <Icon name="archive" size={16} />
          {showArchived ? "Masquer les pipes archivés" : `Voir les pipes archivés (${archivedPipes.length})`}
        </button>
      {/if}
    {:else}
      <div class="list incoming-list">
        {#each space.incoming ?? [] as t (t.id)}
          <div class="card incoming-item">
            {#if t.sender}<Avatar user={t.sender} size={32} />{/if}
            <div class="body">
              <button class="link-title" onclick={() => app.openTask(t.id)}>{t.title}</button>
              <div class="muted small">
                {#if t.sender}{t.sender.id === meId ? "Créée par vous" : `Envoyée par ${t.sender.name}`}{/if}
                · {relativeTime(t.updatedAt)}
                {#if t.dueDate} · échéance {formatDate(t.dueDate)}{/if}
                {#if t.commentCount} · {t.commentCount} commentaire{t.commentCount > 1 ? "s" : ""}{/if}
              </div>
              {#if t.description}<div class="excerpt"><Markdown source={t.description} compact /></div>{/if}
            </div>
            <div class="row actions">
              <button class="btn small" onclick={() => (accepting = t)}><Icon name="check" size={16} />Accepter</button>
              {#if t.sender && t.sender.id !== meId}
                <button class="btn small neutral" onclick={() => (refusing = t)}><Icon name="return" size={16} />Refuser</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty">L'incoming est vide. Les tâches envoyées par d'autres arriveront ici.</div>
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
