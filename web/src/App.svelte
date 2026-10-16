<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./lib/app.svelte";
  import { interceptLinks, navigate, router } from "./lib/router.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TaskModal from "./components/TaskModal.svelte";
  import Icon from "./components/Icon.svelte";
  import Login from "./pages/Login.svelte";
  import Home from "./pages/Home.svelte";
  import SpacePage from "./pages/SpacePage.svelte";
  import PipePage from "./pages/PipePage.svelte";

  let navOpen = $state(false);

  onMount(() => {
    app.init();
  });

  // Shared data (spaces, users) is loaded on login and polled for incoming counts.
  $effect(() => {
    if (!app.me) return;
    app.loadShared().catch(() => {});
    const timer = setInterval(() => app.loadShared().catch(() => {}), 30_000);
    return () => clearInterval(timer);
  });

  // Logged out users are sent to the login page, logged in users away from it.
  $effect(() => {
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
    if ((m = p.match(/^\/spaces\/([^/]+)$/))) return { name: "space", id: m[1] } as const;
    if ((m = p.match(/^\/pipes\/([^/]+)$/))) return { name: "pipe", id: m[1] } as const;
    return { name: "notfound" } as const;
  });
  const taskId = $derived(router.params.get("task"));
</script>

<svelte:document onclick={interceptLinks} />

{#if app.me === null && router.path === "/login"}
  <Login />
{:else if app.me}
  <div class="layout">
    <Sidebar open={navOpen} onclose={() => (navOpen = false)} />
    <main class="main">
      <div class="mobile-bar">
        <button class="btn ghost icon" onclick={() => (navOpen = !navOpen)} aria-label="Menu"><Icon name="menu" /></button>
        <strong>TasksPipes</strong>
      </div>
      {#if route.name === "home"}
        <Home />
      {:else if route.name === "space"}
        {#key route.id}<SpacePage id={route.id} />{/key}
      {:else if route.name === "pipe"}
        {#key route.id}<PipePage id={route.id} />{/key}
      {:else}
        <div class="page"><h1>Page introuvable</h1><p><a href="/">Retour à l'accueil</a></p></div>
      {/if}
    </main>
  </div>
  {#if taskId}
    {#key taskId}<TaskModal id={taskId} onclose={() => app.openTask(null)} />{/key}
  {/if}
{/if}

{#if app.toastMessage}
  {#key app.toastMessage.id}
    <div class="toast {app.toastMessage.type}" role="status">{app.toastMessage.message}</div>
  {/key}
{/if}
