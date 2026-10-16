<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { prefs, t, tn } from "./lib/i18n.svelte";
  import { app } from "./lib/app.svelte";
  import { live } from "./lib/realtime.svelte";
  import { reloadNow, update } from "./lib/version.svelte";
  import { interceptLinks, navigate, router } from "./lib/router.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TaskModal from "./components/TaskModal.svelte";
  import Icon from "./components/Icon.svelte";
  import Login from "./pages/Login.svelte";
  import MagicLogin from "./pages/MagicLogin.svelte";
  import AccountModal from "./components/AccountModal.svelte";
  import CalendarModal from "./components/CalendarModal.svelte";
  import AboutModal from "./components/AboutModal.svelte";
  import InviteModal from "./components/InviteModal.svelte";
  import Home from "./pages/Home.svelte";
  import SpacePage from "./pages/SpacePage.svelte";
  import PipePage from "./pages/PipePage.svelte";
  import MyTasks from "./pages/MyTasks.svelte";
  import Next from "./pages/Next.svelte";
  import Designer from "./pages/Designer.svelte";

  let navOpen = $state(false);

  onMount(() => {
    app.init();
  });

  // Shared data (spaces, users) is loaded on login; then live updates keep it fresh.
  // Polling only stands in while the live connection is down and the page is in use.
  $effect(() => {
    if (!app.me) return;
    app.loadShared().catch(() => {});
    live.start();
    const timer = setInterval(() => {
      if (!live.connected && !live.idle && !document.hidden) app.loadShared().catch(() => {});
    }, 30_000);
    return () => {
      clearInterval(timer);
      live.stop();
    };
  });

  // Language and theme on <html> (the stylesheet follows data-theme, else the system).
  $effect(() => {
    document.documentElement.lang = prefs.lang;
    if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;
    else delete document.documentElement.dataset.theme;
  });

  // Once signed in, the profile's choices prevail (they follow the person from one browser to another).
  $effect(() => {
    const user = app.me?.user;
    if (user) untrack(() => prefs.set({ locale: user.locale, theme: user.theme }));
  });

  // Pipe and task types come translated by the server: reload them when the language changes.
  let catalogLang = prefs.lang;
  $effect(() => {
    const lang = prefs.lang;
    if (lang !== catalogLang && app.me) {
      catalogLang = lang;
      untrack(() => app.loadCatalog().catch(() => {}));
    }
  });

  // Pending tasks: in the tab title and, where supported, on the installed app's icon.
  $effect(() => {
    const n = app.me ? app.pendingCount : 0;
    document.title = n ? `(${n}) TasksPipes` : "TasksPipes";
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
  });

  // Logged out users are sent to the login page, logged in users away from it.
  $effect(() => {
    if (router.path === "/login/magic") return;
    if (app.me === null && router.path !== "/login") navigate(`/login${router.search}`, { replace: true });
    if (app.me && router.path === "/login") navigate("/", { replace: true });
  });

  $effect(() => {
    router.path;
    navOpen = false;
  });

  const route = $derived.by(() => {
    const p = router.path;
    let m: RegExpMatchArray | null;
    if (p === "/") return { name: "home" } as const;
    if (p === "/tasks") return { name: "tasks" } as const;
    if (p === "/next") return { name: "next" } as const;
    if (p === "/designer") return { name: "designer" } as const;
    if ((m = p.match(/^\/spaces\/([^/]+)$/))) return { name: "space", id: m[1] } as const;
    if ((m = p.match(/^\/pipes\/([^/]+)$/))) return { name: "pipe", id: m[1] } as const;
    return { name: "notfound" } as const;
  });
  const taskId = $derived(router.params.get("task"));
</script>

<svelte:document onclick={interceptLinks} />

{#if router.path === "/login/magic"}
  {#if app.me !== undefined}<MagicLogin />{/if}
{:else if app.me === null && router.path === "/login"}
  <Login />
{:else if app.me}
  <div class="layout">
    <Sidebar open={navOpen} onclose={() => (navOpen = false)} />
    <main class="main">
      {#if update.available}
        <div class="update-bar" role="status">
          <span>{t("A new version of TasksPipes is available.")}</span>
          <button class="btn small" onclick={reloadNow}>{t("Reload")}</button>
        </div>
      {/if}
      <div class="mobile-bar">
        <button class="btn ghost icon menu-btn" onclick={() => (navOpen = !navOpen)}
          aria-label={app.pendingCount ? tn(app.pendingCount, "Menu, {n} task waiting", "Menu, {n} tasks waiting") : t("Menu")}>
          <Icon name="menu" />
          {#if app.pendingCount}
            {#key live.arrivals}<span class="pastille" class:pulse={live.arrivals > 0}>{app.pendingCount > 99 ? "99+" : app.pendingCount}</span>{/key}
          {/if}
        </button>
        <strong>TasksPipes</strong>
      </div>
      {#if route.name === "home"}
        <Home />
      {:else if route.name === "tasks"}
        <MyTasks />
      {:else if route.name === "next"}
        <Next />
      {:else if route.name === "designer"}
        <Designer />
      {:else if route.name === "space"}
        {#key route.id}<SpacePage id={route.id} />{/key}
      {:else if route.name === "pipe"}
        {#key route.id}<PipePage id={route.id} />{/key}
      {:else}
        <div class="page"><h1>{t("Page not found")}</h1><p><a href="/">{t("Back to the dashboard")}</a></p></div>
      {/if}
    </main>
  </div>
  {#if app.dialog === "settings"}<AccountModal onclose={() => (app.dialog = null)} />
  {:else if app.dialog === "calendar"}<CalendarModal onclose={() => (app.dialog = null)} />
  {:else if app.dialog === "about"}<AboutModal onclose={() => (app.dialog = null)} />
  {:else if app.dialog === "invite"}<InviteModal onclose={() => (app.dialog = null)} />{/if}
  {#if taskId}
    {#key taskId}<TaskModal id={taskId} onclose={() => app.openTask(null)} />{/key}
  {/if}
{/if}

{#if app.toastMessage}
  {#key app.toastMessage.id}
    <div class="toast {app.toastMessage.type}" role="status">
      <span>{app.toastMessage.message}</span>
      {#if app.toastMessage.action}
        {@const action = app.toastMessage.action}
        <button class="btn small" onclick={() => { action.run(); app.toastMessage = null; }}>{action.label}</button>
      {/if}
    </div>
  {/key}
{/if}
