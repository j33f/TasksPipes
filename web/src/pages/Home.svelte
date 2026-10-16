<script lang="ts">
  import { api } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Task } from "../lib/types";
  import TaskRow from "../components/TaskRow.svelte";
  import SpaceIcon from "../components/SpaceIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import NewTaskModal from "../components/NewTaskModal.svelte";

  let data = $state<{ assigned: Task[]; sent: Task[]; due: Task[] } | null>(null);
  let creating = $state(false);

  $effect(() => {
    app.version;
    api.get<{ assigned: Task[]; sent: Task[]; due: Task[] }>("/home").then((d) => (data = d));
  });

  const hour = new Date().getHours();
  const greeting = hour < 18 ? "Bonjour" : "Bonsoir";
</script>

<div class="page">
  <div class="page-header">
    <div class="grow">
      <h1>{greeting} {app.me?.user.name.split(" ")[0]}</h1>
      <div class="subtitle">Vos tâches, vos pipes et ceux des autres.</div>
    </div>
    <button class="btn" onclick={() => (creating = true)}><Icon name="plus" size={18} />Nouvelle tâche</button>
  </div>

  {#if app.isGuest && !app.me?.user.totp}
    <button class="callout warning secure" onclick={() => (app.accountOpen = true)}>
      <Icon name="shield" />
      <span><strong>Sécurisez votre compte</strong> : activez la double authentification (Google Authenticator) en plus du lien par e-mail.</span>
    </button>
  {/if}

  {#if app.personalSpace?.incomingCount}
    <a class="callout info incoming" href={`/spaces/${app.me?.personalSpaceId}?tab=incoming`}>
      <Icon name="inbox" />
      <span><strong>{app.personalSpace.incomingCount} tâche{app.personalSpace.incomingCount > 1 ? "s" : ""}</strong> en attente dans votre incoming.</span>
    </a>
  {/if}
  {#each app.myTeams.filter((t) => t.incomingCount) as t (t.id)}
    <a class="callout incoming" href={`/spaces/${t.id}?tab=incoming`}>
      <SpaceIcon space={t} size={20} />
      <span><strong>{t.incomingCount}</strong> en attente dans l'incoming de <strong>{t.name}</strong>.</span>
    </a>
  {/each}

  {#if data}
    {#if data.due.length}
      <div class="section">
        <div class="section-title"><Icon name="calendar" />Échéances des 7 prochains jours</div>
        <div class="list">{#each data.due as t (t.id)}<TaskRow task={t} />{/each}</div>
      </div>
    {/if}

    <div class="section">
      <div class="section-title">
        <Icon name="checklist" />Mes tâches
        <span class="spacer"></span>
        <a class="btn ghost small" href="/next"><Icon name="target" size={16} />Prochaine action</a>
        <a class="btn ghost small" href="/tasks">Tout voir</a>
      </div>
      {#if data.assigned.length}
        <div class="list">{#each data.assigned as t (t.id)}<TaskRow task={t} />{/each}</div>
      {:else}
        <div class="empty">Aucune tâche active à votre nom.</div>
      {/if}
    </div>

    <div class="section">
      <div class="section-title"><Icon name="send" />Envoyées, en attente de réponse</div>
      {#if data.sent.length}
        <div class="list">{#each data.sent as t (t.id)}<TaskRow task={t} />{/each}</div>
      {:else}
        <div class="empty">Aucune tâche envoyée en attente.</div>
      {/if}
    </div>
  {/if}

  <div class="section">
    <div class="section-title"><Icon name="users" />Mes équipes</div>
    <div class="grid">
      {#each app.myTeams as t (t.id)}
        <a class="card row" href={`/spaces/${t.id}`}>
          <SpaceIcon space={t} size={32} />
          <div>
            <strong>{t.name}</strong>
            <div class="muted small">{t.memberCount} membre{t.memberCount > 1 ? "s" : ""} · {t.pipeCount} pipe{t.pipeCount > 1 ? "s" : ""}</div>
          </div>
        </a>
      {:else}
        <div class="empty">Vous ne faites partie d'aucune équipe. Créez-en une depuis la barre latérale.</div>
      {/each}
    </div>
  </div>
</div>

{#if creating}<NewTaskModal onclose={() => (creating = false)} />{/if}

<style>
  .incoming { color: var(--text); align-items: center; }
  .secure { width: 100%; border: 0; font: inherit; font-size: 14px; color: var(--text); text-align: left; cursor: pointer; align-items: center; }
  .incoming:hover { text-decoration: none; filter: brightness(0.98); }
</style>
