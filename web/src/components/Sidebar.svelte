<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { router } from "../lib/router.svelte";
  import Avatar from "./Avatar.svelte";
  import SpaceIcon from "./SpaceIcon.svelte";
  import Icon from "./Icon.svelte";
  import TeamModal from "./TeamModal.svelte";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let filter = $state("");
  let showNewTeam = $state(false);

  const isActive = (href: string) => router.path + router.search === href || router.path === href;
  const matches = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const personalId = $derived(app.me?.personalSpaceId);
  const myIncoming = $derived(app.personalSpace?.incomingCount ?? 0);
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={onclose}></div>
{/if}

<nav class="sidebar" class:open>
  <div class="sidebar-header">
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><rect x="7" y="8" width="5" height="16" rx="2" fill="var(--sidebar-background)"/><rect x="14" y="8" width="5" height="11" rx="2" fill="var(--sidebar-background)" opacity=".75"/><rect x="21" y="8" width="5" height="7" rx="2" fill="var(--sidebar-background)" opacity=".5"/></svg>
    <span>TasksPipes</span>
  </div>

  <div class="sidebar-scroll">
    <a class="sidebar-link" class:active={router.path === "/"} href="/">
      <Icon name="home" /><span class="label">Accueil</span>
    </a>
    <a class="sidebar-link" class:active={isActive(`/spaces/${personalId}?tab=incoming`)} href={`/spaces/${personalId}?tab=incoming`}>
      <Icon name="inbox" /><span class="label">Mon incoming</span>
      {#if myIncoming}<span class="count">{myIncoming}</span>{/if}
    </a>
    <a class="sidebar-link" class:active={isActive(`/spaces/${personalId}`)} href={`/spaces/${personalId}`}>
      <Icon name="pipe" /><span class="label">Mes pipes</span>
    </a>

    <div class="sidebar-search">
      <input class="input" placeholder="Filtrer les espaces…" bind:value={filter} />
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-title">
        <span>Mes équipes</span>
        <button class="btn ghost icon small" title="Nouvelle équipe" onclick={() => (showNewTeam = true)}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      {#each app.myTeams.filter((s) => matches(s.name)) as s (s.id)}
        <a class="sidebar-link" class:active={router.path === `/spaces/${s.id}`} href={`/spaces/${s.id}`}>
          <SpaceIcon space={s} size={20} /><span class="label">{s.name}</span>
          {#if s.incomingCount}<span class="count">{s.incomingCount}</span>{/if}
        </a>
      {:else}
        <button class="sidebar-link muted" onclick={() => (showNewTeam = true)}>
          <Icon name="plus" /><span class="label">Créer une équipe</span>
        </button>
      {/each}
    </div>

    {#if app.otherTeams.length}
      <div class="sidebar-section">
        <div class="sidebar-section-title"><span>Autres équipes</span></div>
        {#each app.otherTeams.filter((s) => matches(s.name)) as s (s.id)}
          <a class="sidebar-link" class:active={router.path === `/spaces/${s.id}`} href={`/spaces/${s.id}`}>
            <SpaceIcon space={s} size={20} /><span class="label">{s.name}</span>
          </a>
        {/each}
      </div>
    {/if}

    <div class="sidebar-section">
      <div class="sidebar-section-title"><span>Personnes</span></div>
      {#each app.people.filter((s) => matches(s.name)) as s (s.id)}
        <a class="sidebar-link" class:active={router.path === `/spaces/${s.id}`} class:muted={!s.active}
          href={`/spaces/${s.id}`} title={s.active ? s.name : `${s.name} (ne s'est pas encore connecté·e)`}>
          <SpaceIcon space={s} size={20} /><span class="label">{s.name}</span>
          {#if s.pipeCount}<span class="count neutral">{s.pipeCount}</span>{/if}
        </a>
      {/each}
    </div>
  </div>

  <div class="sidebar-footer">
    <div class="sidebar-link user">
      <Avatar user={app.me?.user} size={24} />
      <span class="label">{app.me?.user.name}</span>
      <button class="btn ghost icon small" title="Se déconnecter" onclick={() => app.logout()}>
        <Icon name="logout" size={18} />
      </button>
    </div>
  </div>
</nav>

{#if showNewTeam}
  <TeamModal onclose={() => (showNewTeam = false)} />
{/if}

<style>
  .sidebar {
    width: var(--sidebar-width); flex-shrink: 0; background: var(--sidebar-background); color: var(--sidebar-text);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .sidebar-header { display: flex; align-items: center; gap: 8px; padding: 16px 16px 8px; font-weight: 600; color: var(--text); font-size: 16px; }
  .sidebar-scroll { flex: 1; overflow-y: auto; padding: 4px 8px 16px; }
  .sidebar-section { margin-top: 16px; }
  .sidebar-section-title {
    display: flex; align-items: center; justify-content: space-between; min-height: 26px;
    font-size: 13px; font-weight: 500; color: var(--text-tertiary); padding: 0 0 0 8px;
  }
  .sidebar-link {
    display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 8px; border-radius: var(--radius);
    color: var(--sidebar-text); font-size: 15px; font-weight: 500; cursor: pointer; border: 0; background: none;
    width: 100%; text-align: left; font-family: inherit;
  }
  .sidebar-link:hover { background: var(--sidebar-hover); text-decoration: none; color: var(--text); }
  .sidebar-link.active { background: var(--sidebar-active); color: var(--text); }
  .sidebar-link.user:hover { background: none; }
  .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar-link.muted .label { opacity: 0.6; }
  .sidebar-search { margin: 12px 0 0; }
  .sidebar-search input { height: 30px; min-height: 30px; font-size: 14px; background: var(--background); }
  .sidebar-footer { padding: 8px; border-top: 1px solid var(--divider); }
  .scrim { display: none; }
  @media (max-width: 900px) {
    .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 50; transform: translateX(-100%); transition: transform 150ms ease; box-shadow: var(--modal-shadow); }
    .sidebar.open { transform: none; }
    .scrim { display: block; position: fixed; inset: 0; z-index: 49; background: var(--modal-backdrop); }
  }
</style>
