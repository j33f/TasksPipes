<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { router } from "../lib/router.svelte";
  import Avatar from "./Avatar.svelte";
  import SpaceIcon from "./SpaceIcon.svelte";
  import Icon from "./Icon.svelte";
  import TeamModal from "./TeamModal.svelte";
  import InviteModal from "./InviteModal.svelte";
  import PipeIcon from "./PipeIcon.svelte";
  import PipeModal from "./PipeModal.svelte";
  import NewTaskModal from "./NewTaskModal.svelte";
  import { api, errorMessage } from "../lib/api";
  import { navigate } from "../lib/router.svelte";
  import { openTaskCount } from "../lib/constants";
  import type { SidebarPipe } from "../lib/types";
  import { t, tn } from "../lib/i18n.svelte";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let filter = $state("");
  let showNewTeam = $state(false);
  let showInvite = $state(false);

  const isActive = (href: string) => router.path + router.search === href || router.path === href;
  const matches = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const personalId = $derived(app.me?.personalSpaceId);
  const myIncoming = $derived(app.personalSpace?.incomingCount ?? 0);

  // Foldable entries ("My pipes", each team, "People"…), like Outline collections; remembered per browser.
  const legacyMyPipes = () => { try { return localStorage.getItem("tp:myPipesOpen") === "1"; } catch { return false; } };
  const DEFAULT_OPEN: Record<string, boolean> = { myPipes: legacyMyPipes(), people: false, otherTeams: false };
  const readFolds = (): Record<string, boolean> => {
    try { return JSON.parse(localStorage.getItem("tp:folds") || "{}"); } catch { return {}; }
  };
  let folds = $state(readFolds());
  // Teams are unfolded unless folded by hand; a filter unfolds everything.
  const isOpen = (key: string) => Boolean(filter.trim()) || (folds[key] ?? DEFAULT_OPEN[key] ?? key.startsWith("team:"));
  function toggle(key: string) {
    folds = { ...folds, [key]: !isOpen(key) };
    try { localStorage.setItem("tp:folds", JSON.stringify(folds)); } catch { /* storage unavailable */ }
  }
  const teamPipes = (spaceId: string) => app.sidebar.teams.filter((p) => p.spaceId === spaceId);

  // Hover actions of a pipe: "+" adds a task, "…" opens its menu.
  let menu = $state<{ pipe: SidebarPipe; style: string } | null>(null);
  let menuEl = $state<HTMLElement>();
  let renamingId = $state<string | null>(null);
  let newTaskPipe = $state<SidebarPipe | null>(null);
  let editing = $state<SidebarPipe | null>(null);

  function openMenu(e: MouseEvent, pipe: SidebarPipe) {
    if (menu?.pipe.id === pipe.id) return (menu = null);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - 236);
    const style = r.bottom + 260 > window.innerHeight
      ? `left:${left}px;bottom:${window.innerHeight - r.top + 4}px`
      : `left:${left}px;top:${r.bottom + 4}px`;
    menu = { pipe, style };
  }

  function closeMenuOutside(e: MouseEvent) {
    if (menu && menuEl && !menuEl.contains(e.target as Node) && !(e.target as Element).closest?.("[data-menu-trigger]")) menu = null;
  }

  async function run(fn: () => Promise<unknown>, success?: string) {
    menu = null;
    try {
      await fn();
      if (success) app.toast(success);
      app.refresh();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }

  function rename(pipe: SidebarPipe, e: FocusEvent) {
    const name = (e.currentTarget as HTMLInputElement).value.trim();
    renamingId = null;
    if (name && name !== pipe.name) run(() => api.patch(`/pipes/${pipe.id}`, { name }));
  }

  function renameKeydown(e: KeyboardEvent) {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === "Escape") { renamingId = null; return; }
    if (e.key === "Enter") input.blur();
  }

  function remove(pipe: SidebarPipe) {
    if (!confirm(t("Delete the pipe “{name}”?", { name: pipe.name }))) return (menu = null);
    run(async () => {
      await api.del(`/pipes/${pipe.id}`);
      if (router.path === `/pipes/${pipe.id}`) navigate(`/spaces/${pipe.spaceId}`);
    }, t("Pipe deleted"));
  }
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
    <div class="sidebar-section first">
      <div class="sidebar-section-title"><span>{t("Me")}</span></div>
      <a class="sidebar-link" class:active={router.path === "/"} href="/">
        <Icon name="home" /><span class="label">{t("My dashboard")}</span>
      </a>
      <a class="sidebar-link" class:active={router.path === "/tasks"} href="/tasks">
        <Icon name="checklist" /><span class="label">{t("My tasks")}</span>
      </a>
      <a class="sidebar-link" class:active={router.path === "/next"} href="/next">
        <Icon name="target" /><span class="label">{t("Next action")}</span>
      </a>
      <a class="sidebar-link" class:active={isActive(`/spaces/${personalId}?tab=incoming`)} href={`/spaces/${personalId}?tab=incoming`}>
        <Icon name="inbox" /><span class="label">Incoming</span>
        {#if myIncoming}<span class="count">{myIncoming}</span>{/if}
      </a>
      <div class="sidebar-link has-disclosure hover-actions" class:active={isActive(`/spaces/${personalId}`)}>
        {@render disclosure("myPipes")}
        <a class="row-link" href={`/spaces/${personalId}`}>
          <Icon name="pipe" /><span class="label">{t("My pipes")}</span>
        </a>
        <span class="actions">
          <a class="act" title={t("New pipe")} href={`/spaces/${personalId}?newPipe=1`}><Icon name="plus" size={16} /></a>
        </span>
      </div>
      {#if isOpen("myPipes")}
        {#each app.sidebar.mine as p (p.id)}
          {@render pipeLink(p, null, true)}
        {/each}
      {/if}
    </div>

    {#if app.sidebar.pinned.length}
      <div class="sidebar-section">
        <div class="sidebar-section-title"><span>{t("Pinned")}</span></div>
        {#each app.sidebar.pinned as p (p.id)}
          {@render pipeLink(p, p.spaceId === personalId ? null : (p.spaceName ?? null), false)}
        {/each}
      </div>
    {/if}

    <div class="sidebar-search">
      <input class="input" placeholder={t("Filter teams and people…")} bind:value={filter} />
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-title">
        <span>{t("My teams")}</span>
        <button class="btn ghost icon small" title={t("New team")} onclick={() => (showNewTeam = true)}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      {#each app.myTeams.filter((s) => matches(s.name)) as s (s.id)}
        {@const pipes = teamPipes(s.id)}
        <div class="sidebar-link has-disclosure hover-actions" class:active={router.path === `/spaces/${s.id}`}>
          {#if pipes.length}{@render disclosure(`team:${s.id}`)}{:else}<span class="disclosure-space"></span>{/if}
          <a class="row-link" href={`/spaces/${s.id}`}>
            <SpaceIcon space={s} size={20} /><span class="label">{s.name}</span>
            {#if s.incomingCount}<span class="count" title={t("Waiting in the incoming")}>{s.incomingCount}</span>{/if}
          </a>
          <span class="actions">
            <a class="act" title={t("New pipe")} href={`/spaces/${s.id}?newPipe=1`}><Icon name="plus" size={16} /></a>
          </span>
        </div>
        {#if isOpen(`team:${s.id}`)}
          {#each pipes as p (p.id)}{@render pipeLink(p, null, true)}{/each}
        {/if}
      {:else}
        <button class="sidebar-link muted" onclick={() => (showNewTeam = true)}>
          <Icon name="plus" /><span class="label">{t("Create a team")}</span>
        </button>
      {/each}
    </div>

    {#if app.otherTeams.length}
      {@const others = app.otherTeams.filter((s) => matches(s.name))}
      <div class="sidebar-section">
        {@render foldTitle("otherTeams", t("Other teams"), others.length)}
        {#if isOpen("otherTeams")}
          {#each others as s (s.id)}
            <a class="sidebar-link" class:active={router.path === `/spaces/${s.id}`} href={`/spaces/${s.id}`}>
              <SpaceIcon space={s} size={20} /><span class="label">{s.name}</span>
            </a>
          {/each}
        {/if}
      </div>
    {/if}

    {#if app.people.length}
      {@const people = app.people.filter((s) => matches(s.name))}
      <div class="sidebar-section">
        {@render foldTitle("people", t("People"), people.length, () => (showInvite = true), t("Invite by e-mail"))}
        {#if isOpen("people")}
          {#each people as s (s.id)}
            <a class="sidebar-link" class:active={router.path === `/spaces/${s.id}`} class:muted={!s.active}
              href={`/spaces/${s.id}`} title={s.active ? s.name : t("{name} (has not signed in yet)", { name: s.name })}>
              <SpaceIcon space={s} size={20} /><span class="label">{s.name}</span>
              {#if s.guest}<span class="guest" title={t("Invited by e-mail")}><Icon name="mail" size={14} /></span>{/if}
              {#if s.pipeCount}<span class="count neutral">{s.pipeCount}</span>{/if}
            </a>
          {/each}
        {/if}
      </div>
    {/if}

    <div class="sidebar-section">
      <a class="sidebar-link" class:active={router.path === "/designer"} href="/designer">
        <Icon name="clipboard" /><span class="label">{t("Models")}</span>
      </a>
    </div>
  </div>

  <div class="sidebar-footer">
    <div class="sidebar-link user">
      <button class="account" title={t("My account, invitations")} onclick={() => (app.accountOpen = true)}>
        <Avatar user={app.me?.user} size={24} />
        <span class="label">{app.me?.user.name}</span>
      </button>
      <button class="btn ghost icon small" title={t("Sign out")} onclick={() => app.logout()}>
        <Icon name="logout" size={18} />
      </button>
    </div>
  </div>
</nav>

{#snippet disclosure(key: string)}
  <button class="disclosure" class:open={isOpen(key)} aria-expanded={isOpen(key)}
    title={isOpen(key) ? t("Fold") : t("Unfold")} onclick={() => toggle(key)}><Icon name="chevron" size={14} /></button>
{/snippet}

{#snippet foldTitle(key: string, label: string, count: number, onadd?: () => void, addTitle?: string)}
  <div class="fold-row">
    <button class="sidebar-section-title fold" aria-expanded={isOpen(key)} onclick={() => toggle(key)}>
      <span class="disclosure" class:open={isOpen(key)}><Icon name="chevron" size={12} /></span>
      <span class="grow">{label}</span>
      {#if !isOpen(key)}<span class="fold-count">{count}</span>{/if}
    </button>
    {#if onadd}
      <button class="btn ghost icon small" title={addTitle} onclick={onadd}><Icon name="plus" size={16} /></button>
    {/if}
  </div>
{/snippet}

{#snippet pipeLink(p: SidebarPipe, spaceName: string | null, nested: boolean)}
  {#if renamingId === p.id}
    <div class="sidebar-link pipe-link" class:nested>
      <PipeIcon pipe={p} size={18} />
      <!-- svelte-ignore a11y_autofocus -->
      <input class="rename" value={p.name} maxlength="120" aria-label={t("Pipe name")} autofocus
        onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} onblur={(e) => rename(p, e)} onkeydown={renameKeydown} />
    </div>
  {:else}
    <div class="sidebar-link pipe-link hover-actions" class:nested class:active={router.path === `/pipes/${p.id}`}
      class:menu-open={menu?.pipe.id === p.id}>
      <a class="row-link" href={`/pipes/${p.id}`} title={spaceName ? `${spaceName} › ${p.name}` : p.name}>
        <PipeIcon pipe={p} size={18} />
        <span class="label">{p.name}{#if spaceName}<span class="space-name"> · {spaceName}</span>{/if}</span>
      </a>
      <span class="actions">
        <button class="act" title={t("New task")} onclick={() => (newTaskPipe = p)}><Icon name="plus" size={16} /></button>
        <button class="act" title={t("More actions")} data-menu-trigger onclick={(e) => openMenu(e, p)}><Icon name="more" size={16} /></button>
      </span>
    </div>
  {/if}
{/snippet}

<svelte:window onmousedown={closeMenuOutside} onkeydown={(e) => e.key === "Escape" && (menu = null)} onresize={() => (menu = null)} />

{#if menu}
  {@const p = menu.pipe}
  {@const pinned = app.isPinned(p.id)}
  {@const open = openTaskCount(p.counts)}
  <div class="pipe-menu" style={menu.style} bind:this={menuEl} role="menu">
    <button class="menu-item" role="menuitem" onclick={() => { menu = null; newTaskPipe = p; }}><Icon name="plus" size={16} />{t("New task")}</button>
    {#if p.canManage}
      <button class="menu-item" role="menuitem" onclick={() => { menu = null; renamingId = p.id; }}><Icon name="edit" size={16} />{t("Rename")}</button>
      <button class="menu-item" role="menuitem" onclick={() => { menu = null; editing = p; }}><Icon name="settings" size={16} />{t("Icon, colour, type…")}</button>
    {/if}
    <button class="menu-item" role="menuitem" onclick={() => run(() => app.setPinned(p.id, !pinned), pinned ? t("Pipe unpinned") : t("Pipe pinned"))}>
      <Icon name="pin" size={16} />{pinned ? t("Unpin") : t("Pin")}
    </button>
    {#if p.canManage && !p.isDefault}
      <div class="menu-sep"></div>
      <button class="menu-item" role="menuitem" disabled={open > 0}
        title={open > 0 ? tn(open, "Still {n} open task: finish or drop it before archiving", "Still {n} open tasks: finish or drop them before archiving") : undefined}
        onclick={() => run(() => api.patch(`/pipes/${p.id}`, { archived: true }), t("Pipe archived"))}>
        <Icon name="archive" size={16} />{t("Archive")}
      </button>
      <button class="menu-item danger" role="menuitem" onclick={() => remove(p)}><Icon name="trash" size={16} />{t("Delete")}</button>
    {/if}
  </div>
{/if}

{#if newTaskPipe}
  <NewTaskModal pipe={{ id: newTaskPipe.id, name: newTaskPipe.name, spaceId: newTaskPipe.spaceId, kind: newTaskPipe.kind }} onclose={() => (newTaskPipe = null)} />
{/if}
{#if editing}<PipeModal spaceId={editing.spaceId} pipe={editing} onclose={() => (editing = null)} />{/if}

{#if showInvite}<InviteModal onclose={() => (showInvite = false)} />{/if}

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
  .sidebar-section.first { margin-top: 0; }
  .fold { width: 100%; border: 0; background: none; font: inherit; font-size: 13px; cursor: pointer; padding-left: 0; justify-content: flex-start; gap: 0; border-radius: var(--radius); }
  .fold:hover { color: var(--text); }
  .fold .disclosure { width: 20px; height: 20px; margin-right: 0; }
  .fold .grow { flex: 1; text-align: left; }
  .fold-row { display: flex; align-items: center; }
  .fold-row .fold { flex: 1; min-width: 0; }
  .guest { color: var(--text-tertiary); display: flex; }
  .account {
    display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; border: 0; background: none; padding: 2px 4px;
    margin-left: -4px; border-radius: var(--radius); font: inherit; color: inherit; cursor: pointer; text-align: left;
  }
  .account:hover { background: var(--sidebar-hover); }
  .fold-count { font-size: 12px; padding-right: 8px; }
  .disclosure-space { width: 22px; flex-shrink: 0; }
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
  .has-disclosure { padding-left: 0; gap: 0; }
  .has-disclosure .row-link { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; color: inherit; text-decoration: none; padding: 0 0 0 2px; }
  .disclosure {
    border: 0; background: none; color: var(--text-tertiary); width: 20px; height: 24px; padding: 0; margin-right: 2px;
    display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 4px; flex-shrink: 0;
  }
  .disclosure:hover { color: var(--text); }
  .disclosure :global(svg) { transition: transform 100ms ease; }
  .disclosure.open :global(svg) { transform: rotate(90deg); }
  .pipe-link { font-size: 14px; min-height: 30px; gap: 0; padding-right: 4px; }
  .pipe-link .row-link { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; color: inherit; text-decoration: none; }
  .pipe-link.nested { padding-left: 30px; }
  .space-name { color: var(--text-tertiary); font-weight: 400; }
  .rename {
    flex: 1; min-width: 0; margin-left: 8px; font: inherit; color: var(--text); background: var(--background);
    border: 1px solid var(--input-border-focused); border-radius: 4px; padding: 1px 4px; outline: none;
  }
  .actions { display: none; align-items: center; gap: 2px; flex-shrink: 0; }
  .hover-actions:hover .actions, .hover-actions:focus-within .actions, .hover-actions.menu-open .actions { display: flex; }
  .hover-actions:hover, .hover-actions.menu-open { background: var(--sidebar-hover); color: var(--text); }
  .act {
    border: 0; background: none; padding: 3px; border-radius: 4px; cursor: pointer; color: var(--text-tertiary);
    display: flex; align-items: center;
  }
  .act:hover { color: var(--text); background: var(--sidebar-active); text-decoration: none; }
  .pipe-menu {
    position: fixed; z-index: 60; width: 220px; padding: 6px; border-radius: 8px;
    background: var(--modal-background); box-shadow: var(--menu-shadow);
  }
  .pipe-menu .menu-item:disabled { opacity: 0.45; cursor: default; background: none; }
  .pipe-menu .danger { color: var(--danger); }
  .menu-sep { height: 1px; background: var(--divider); margin: 6px 4px; }
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
