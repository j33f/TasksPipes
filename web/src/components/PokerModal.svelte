<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t, tn } from "../lib/i18n.svelte";
  import { POINTS } from "../lib/labels";
  import { live } from "../lib/realtime.svelte";
  import { num } from "../lib/sprints";
  import type { PipeDetail, PokerCard, PokerSession } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";

  /**
   * Planning Poker of a team pipe: with no session open, choose the tasks to estimate; then the table — the tasks,
   * the one being estimated, the team's cards (face down until shown), one's own hand, and for the one who leads:
   * show the cards, another round, set the points. Kept up to date by the live connection; the page also says every
   * few seconds that it is still at the table.
   */
  let { pipe, onclose }: { pipe: PipeDetail; onclose: () => void } = $props();

  const DECK: PokerCard[] = ["0", "1", "2", "3", "5", "8", "13", "21", "40", "100", "?", "coffee"];
  const cardText = (c: PokerCard) => (c === "coffee" ? "☕" : c);

  let session = $state<PokerSession | null>(null);
  let loaded = $state(false);
  let error = $state("");
  let busy = $state(false);

  async function load() {
    try {
      const r = await api.get<{ enabled: boolean; session: PokerSession | null }>(`/pipes/${pipe.id}/poker`);
      session = r.session;
      loaded = true;
    } catch (err) {
      error = errorMessage(err);
    }
  }
  // On each change told by the live connection, and every 15 s (being at the table).
  $effect(() => {
    live.poker;
    untrack(load);
  });
  $effect(() => {
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  });

  async function act(path: string, body?: unknown) {
    if (!session) return;
    busy = true;
    error = "";
    try {
      session = await api.post<PokerSession>(`/poker/${session.id}/${path}`, body ?? {});
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  function leave() {
    if (session) api.post(`/poker/${session.id}/leave`, {}).catch(() => {});
    onclose();
  }

  async function closeSession() {
    if (!session || !confirm(t("Close the session for everyone?"))) return;
    try {
      await api.post(`/poker/${session.id}/close`, {});
      app.refresh();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  // ----- Opening a session: the tasks to estimate (those without points first).
  const candidates = $derived(
    pipe.tasks
      .filter((x) => x.status !== "done" && x.status !== "abandoned" && !pipe.sprints?.some((s) => s.id === x.sprintId && s.status === "closed"))
      .sort((a, b) => Number(a.points !== null) - Number(b.points !== null) || a.position - b.position)
  );
  let picked = $state<string[]>(untrack(() => candidates.filter((x) => x.points === null).slice(0, 20).map((x) => x.id)));
  const sprintName = (id: string | null | undefined) => pipe.sprints?.find((s) => s.id === id)?.name ?? t("Backlog");

  async function open() {
    busy = true;
    error = "";
    try {
      session = await api.post<PokerSession>(`/pipes/${pipe.id}/poker`, { taskIds: picked });
      app.refresh();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  // ----- At the table
  const meId = $derived(app.me?.user.id);
  const leading = $derived(session?.facilitatorId === meId);
  const leader = $derived(session?.participants.find((p) => p.id === session?.facilitatorId)?.name ?? null);
  const current = $derived(session?.tasks.find((x) => x.id === session?.currentTaskId) ?? null);
  const mine = $derived(session?.participants.find((p) => p.id === meId)?.vote ?? null);
  const votes = $derived(session?.participants.filter((p) => p.voted).length ?? 0);
  let chosen = $state<number | null>(null);
  // The suggestion is preselected once the cards are shown.
  $effect(() => {
    if (session?.revealed) chosen = untrack(() => chosen) ?? session.stats?.suggestion ?? null;
    else chosen = null;
  });
</script>

<Modal title={t("Planning Poker")} onclose={leave} large>
  {#if !loaded}
    <p class="muted">{error || t("Loading…")}</p>
  {:else if !session}
    <p class="muted small intro">{t("Choose the tasks to estimate together; you will lead the session. The team's members join it from the pipe.")}</p>
    {#if candidates.length}
      <ul class="pick">
        {#each candidates as x (x.id)}
          <li>
            <label>
              <input type="checkbox" checked={picked.includes(x.id)}
                onchange={(e) => (picked = (e.currentTarget as HTMLInputElement).checked ? [...picked, x.id] : picked.filter((id) => id !== x.id))} />
              <span class="title">{x.title}</span>
              <span class="muted small">{sprintName(x.sprintId)}</span>
              <span class="pts" class:none={x.points === null}>{x.points ?? "–"}</span>
            </label>
          </li>
        {/each}
      </ul>
    {:else}<p class="muted">{t("No unfinished task to estimate.")}</p>{/if}
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <span class="muted small">{tn(picked.length, "{n} task chosen", "{n} tasks chosen")}</span>
      <span class="spacer"></span>
      <button class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn" disabled={busy || !picked.length || picked.length > 50} onclick={open}><Icon name="play" size={16} />{t("Open the session")}</button>
    </div>
  {:else}
    <div class="table-layout">
      <aside class="queue" aria-label={t("Tasks to estimate")}>
        <ol>
          {#each session.tasks as x (x.id)}
            <li class:current={x.id === session.currentTaskId} class:estimated={x.estimated !== null}>
              <button disabled={!leading || busy || x.id === session.currentTaskId} onclick={() => act("current", { taskId: x.id })}>
                <span class="title">{x.title}</span>
                <span class="pts" class:none={(x.estimated ?? x.points) === null}>{x.estimated ?? x.points ?? "–"}</span>
              </button>
            </li>
          {/each}
        </ol>
        <p class="muted small">{tn(session.tasks.filter((x) => x.estimated !== null).length, "{n} estimated", "{n} estimated")} / {session.tasks.length}</p>
      </aside>

      <section class="board">
        {#if current}
          <div class="current">
            <div class="muted small">{t("Round {n}", { n: session.round })} · #{current.number}</div>
            <h3>{current.title}</h3>
            <button class="link-button small" onclick={() => app.openTask(current!.id)}>{t("Open the task")}</button>
          </div>

          <ul class="players" aria-label={t("The team")}>
            {#each session.participants as p (p.id)}
              <li class:away={!p.present}>
                <div class="card" class:face={session.revealed && p.vote !== null} class:back={!session.revealed && p.voted}
                  aria-label={session.revealed ? (p.vote ? cardText(p.vote) : t("No card")) : p.voted ? t("Card picked") : t("Thinking")}>
                  {#if session.revealed}{p.vote ? cardText(p.vote) : "–"}{:else if p.voted}<Icon name="check" size={18} />{:else}…{/if}
                </div>
                <span class="who"><Avatar user={p} size={18} />{p.name.split(" ")[0]}{#if p.id === session.facilitatorId} <Icon name="star" size={11} />{/if}</span>
              </li>
            {/each}
          </ul>

          {#if session.revealed && session.stats}
            <div class="stats" role="status">
              {#if session.stats.consensus}<strong class="consensus"><Icon name="check" size={14} />{t("Everyone agrees")}</strong>
              {:else if session.stats.count}
                <span>{t("From {min} to {max}", { min: session.stats.min ?? "–", max: session.stats.max ?? "–" })}</span>
                <span>{t("median {n}", { n: session.stats.median === null ? "–" : num(session.stats.median) })}</span>
              {:else}<span>{t("No number among the cards")}</span>{/if}
            </div>
          {/if}

          <div class="hand" role="group" aria-label={t("Your card")}>
            {#each DECK as c (c)}
              <button class="pick-card" class:selected={mine === c} disabled={busy || session.revealed} aria-pressed={mine === c}
                onclick={() => act("vote", { value: mine === c ? null : c })}>{cardText(c)}</button>
            {/each}
          </div>

          {#if leading}
            <div class="lead">
              {#if !session.revealed}
                <button class="btn" disabled={busy || !votes} onclick={() => act("reveal")}>{t("Show the cards")} ({votes})</button>
              {:else}
                <button class="btn neutral" disabled={busy} onclick={() => act("round")}>{t("Another round")}</button>
                <span class="set">
                  <select class="input" value={chosen ?? ""} aria-label={t("Points")}
                    onchange={(e) => (chosen = Number((e.currentTarget as HTMLSelectElement).value))}>
                    <option value="" disabled>{t("Points")}</option>
                    {#each POINTS as n (n)}<option value={n}>{n}{n === session.stats?.suggestion ? ` (${t("suggested")})` : ""}</option>{/each}
                  </select>
                  <button class="btn" disabled={busy || chosen === null} onclick={() => act("estimate", { points: chosen })}>{t("Set the points")}</button>
                </span>
              {/if}
            </div>
          {:else}
            <p class="muted small">{leader ? t("{name} leads the session.", { name: leader }) : t("No one leads the session.")}
              <button class="link-button" onclick={() => act("lead")}>{t("Take the lead")}</button></p>
          {/if}
        {:else}
          <div class="done-all"><Icon name="check" size={20} /><p>{t("All the tasks of the session are estimated.")}</p></div>
        {/if}
        {#if error}<div class="error-text">{error}</div>{/if}
      </section>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick={closeSession}><Icon name="close" size={16} />{t("Close the session")}</button>
      <span class="spacer"></span>
      <button class="btn neutral" onclick={leave}>{t("Leave the table")}</button>
    </div>
  {/if}
</Modal>

<style>
  .intro { margin-top: 0; }
  .pick { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow-y: auto; border: 1px solid var(--divider); border-radius: 8px; }
  .pick li + li { border-top: 1px solid var(--divider); }
  .pick label { display: flex; align-items: center; gap: 10px; padding: 7px 10px; cursor: pointer; font-size: 14px; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .pts { font-size: 12px; font-weight: 600; min-width: 22px; padding: 0 6px; text-align: center; border-radius: 9px; background: var(--background-tertiary); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .pts.none { background: none; border: 1px dashed var(--divider); color: var(--text-tertiary); }
  .table-layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; }
  @media (max-width: 700px) { .table-layout { grid-template-columns: 1fr; } .queue { order: 2; } }
  .queue ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; max-height: 50vh; overflow-y: auto; }
  .queue button {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid transparent;
    background: var(--background-secondary); font: inherit; font-size: 13px; color: var(--text); cursor: pointer;
  }
  .queue button:disabled { cursor: default; }
  .queue li.current button { border-color: var(--accent); background: var(--modal-background, var(--background)); font-weight: 600; }
  .queue li.estimated .title { color: var(--text-tertiary); }
  .board { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .current h3 { margin: 2px 0 2px; font-size: 18px; }
  .link-button { background: none; border: 0; padding: 0; font: inherit; color: var(--link); cursor: pointer; }
  .players { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 14px; }
  .players li { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .players li.away { opacity: 0.5; }
  .card {
    width: 46px; height: 64px; border-radius: 8px; border: 2px dashed var(--divider); display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 700; color: var(--text-tertiary); font-variant-numeric: tabular-nums;
  }
  .card.back { border: 0; background: repeating-linear-gradient(45deg, var(--accent), var(--accent) 6px, color-mix(in srgb, var(--accent) 80%, #fff) 6px, color-mix(in srgb, var(--accent) 80%, #fff) 12px); color: #fff; }
  .card.face { border: 2px solid var(--accent); background: var(--modal-background, var(--background)); color: var(--text); }
  .who { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-secondary); }
  .stats { display: flex; gap: 14px; flex-wrap: wrap; font-size: 14px; color: var(--text-secondary); }
  .consensus { display: inline-flex; align-items: center; gap: 6px; color: #2a9d63; }
  .hand { display: flex; flex-wrap: wrap; gap: 6px; }
  .pick-card {
    width: 44px; height: 58px; border-radius: 8px; border: 1px solid var(--button-neutral-border); background: var(--button-neutral-bg);
    font: inherit; font-size: 16px; font-weight: 700; color: var(--text); cursor: pointer; font-variant-numeric: tabular-nums;
    transition: transform 0.1s;
  }
  .pick-card:hover:not(:disabled) { transform: translateY(-3px); }
  .pick-card.selected { background: var(--accent); border-color: var(--accent); color: var(--accent-text); transform: translateY(-6px); }
  .pick-card:disabled { opacity: 0.5; cursor: default; }
  .lead { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .set { display: inline-flex; gap: 6px; align-items: center; }
  .set .input { width: auto; }
  .done-all { display: flex; align-items: center; gap: 10px; color: #2a9d63; }
</style>
