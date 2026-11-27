<script lang="ts">
  // The AI assistant on a task. It first proposes changes (title, description, fields), shown next to what is there;
  // only what the person ticks is applied. It can also ask its questions — each with the answers it guesses, "Other"
  // (free text) and "Let's discuss it" (a short discussion) — and then propose again with what the person said.
  // Nothing changes until "Apply"; answers and discussion live in this window only.
  import { onMount, tick } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { TaskDetail, TaskType } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import Modal from "./Modal.svelte";

  let { task, type, onclose, ondone }: { task: TaskDetail; type: TaskType | undefined; onclose: () => void; ondone: () => void } = $props();

  interface Proposal {
    title?: string;
    description?: string;
    fields?: Record<string, unknown>;
    notes?: string;
  }
  interface Question {
    question: string;
    options: string[];
  }
  type Message = { role: "user" | "assistant"; content: string };
  /** One answer: an option, or "other" with free text. */
  type Answer = { choice: string; other: string };
  const OTHER = "\u0000other";

  let mode = $state<"proposal" | "questions">("proposal");
  let proposal = $state<Proposal | null>(null);
  let questions = $state<Question[] | null>(null);
  let answers = $state<Answer[]>([]);
  let discussion = $state<Message[]>([]);
  let discussing = $state(false);
  let draft = $state("");
  let error = $state("");
  let busy = $state(true);
  /** What is kept: "title", "description", and field ids. */
  let kept = $state<Record<string, boolean>>({});
  let thread = $state<HTMLElement | null>(null);

  const fieldLabel = (id: string) => type?.fields.find((f) => f.id === id)?.label ?? id;
  const shown = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? t("Yes") : t("No")) : String(v);
  const nothing = $derived(proposal !== null && !proposal.title && !proposal.description && !Object.keys(proposal.fields ?? {}).length);

  /** The answers given, as the server takes them. */
  const given = () =>
    (questions ?? [])
      .map((q, i) => ({ question: q.question, answer: answers[i]?.choice === OTHER ? answers[i].other.trim() : (answers[i]?.choice ?? "") }))
      .filter((a) => a.answer);
  const told = $derived(questions !== null && (given().length > 0 || discussion.length > 0));

  async function propose() {
    mode = "proposal";
    busy = true;
    error = "";
    proposal = null;
    try {
      const p = await api.post<Proposal>(`/tasks/${task.id}/assist`, { answers: given(), discussion });
      proposal = p;
      kept = Object.fromEntries([...(p.title ? ["title"] : []), ...(p.description ? ["description"] : []), ...Object.keys(p.fields ?? {})].map((k) => [k, true]));
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
  onMount(propose);

  async function ask() {
    mode = "questions";
    if (questions) return;
    busy = true;
    error = "";
    try {
      questions = (await api.post<{ questions: Question[] }>(`/tasks/${task.id}/assist/questions`)).questions;
      answers = questions.map(() => ({ choice: "", other: "" }));
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  /** "Let's discuss it" on a question: the discussion opens with it. */
  function discuss(q?: Question) {
    discussing = true;
    if (q && !discussion.some((m) => m.role === "assistant" && m.content === q.question)) discussion = [...discussion, { role: "assistant", content: q.question }];
    tick().then(() => thread?.querySelector("textarea")?.focus());
  }

  async function say(e: SubmitEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    discussion = [...discussion, { role: "user", content: text }];
    draft = "";
    busy = true;
    error = "";
    try {
      const { reply } = await api.post<{ reply: string }>(`/tasks/${task.id}/assist/discussion`, { messages: discussion });
      discussion = [...discussion, { role: "assistant", content: reply }];
      await tick();
      thread?.querySelector(".messages")?.scrollTo({ top: 1e9 });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function apply(e: SubmitEvent) {
    e.preventDefault();
    if (!proposal) return;
    const body: Record<string, unknown> = {};
    if (proposal.title && kept.title) body.title = proposal.title;
    if (proposal.description && kept.description) body.description = proposal.description;
    const fields = Object.fromEntries(Object.entries(proposal.fields ?? {}).filter(([id]) => kept[id]));
    if (Object.keys(fields).length) body.fields = fields;
    if (!Object.keys(body).length) return onclose();
    busy = true;
    try {
      await api.patch(`/tasks/${task.id}`, body);
      app.toast(t("The assistant's proposal was applied"));
      ondone();
      onclose();
    } catch (err) {
      error = errorMessage(err);
      busy = false;
    }
  }
</script>

<Modal title={t("AI assistant")} large {onclose}>
  {#if mode === "proposal"}
    <form onsubmit={apply}>
      {#if busy && !proposal}
        <p class="muted thinking"><Icon name="sparkles" size={16} />{t("The assistant reads the task and its comments…")}</p>
      {:else if proposal}
        {#if nothing}
          <p class="muted">{t("The assistant has nothing to change.")}</p>
        {:else}
          <p class="muted small" style="margin-top:0">{t("Tick what to keep. Nothing changes until you apply it.")}</p>
        {/if}
        {#if proposal.title}
          <label class="part">
            <input type="checkbox" bind:checked={kept.title} />
            <span class="grow">
              <span class="label-text">{t("Title")}</span>
              <span class="before">{task.title}</span>
              <span class="after">{proposal.title}</span>
            </span>
          </label>
        {/if}
        {#if proposal.description}
          <label class="part">
            <input type="checkbox" bind:checked={kept.description} />
            <span class="grow">
              <span class="label-text">{t("Description")}</span>
              <span class="cols">
                <span class="box before-box">{#if task.description}<Markdown source={task.description} />{:else}<span class="muted">{t("No description.")}</span>{/if}</span>
                <span class="box after-box"><Markdown source={proposal.description} /></span>
              </span>
            </span>
          </label>
        {/if}
        {#each Object.entries(proposal.fields ?? {}) as [id, value] (id)}
          <label class="part">
            <input type="checkbox" bind:checked={kept[id]} />
            <span class="grow">
              <span class="label-text">{fieldLabel(id)}</span>
              <span class="before">{shown(task.fields?.[id])}</span>
              <span class="after">{shown(value)}</span>
            </span>
          </label>
        {/each}
        {#if proposal.notes}
          <div class="callout info"><Icon name="sparkles" /><div class="grow">{proposal.notes}</div></div>
        {/if}
      {/if}
      {#if error}<div class="error-text" role="alert">{error}</div>{/if}
      <div class="modal-actions">
        <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
        {#if error || (proposal && !busy)}
          <button type="button" class="btn neutral" disabled={busy} onclick={ask}><Icon name="info" size={16} />{t("Answer its questions")}</button>
          <button type="button" class="btn neutral" disabled={busy} onclick={propose}>{t("Ask again")}</button>
        {/if}
        {#if proposal && !nothing}
          <button class="btn" disabled={busy || !Object.values(kept).some(Boolean)}>{t("Apply")}</button>
        {/if}
      </div>
    </form>
  {:else}
    {#if busy && !questions}
      <p class="muted thinking"><Icon name="sparkles" size={16} />{t("The assistant looks for what is missing…")}</p>
    {:else if questions && !questions.length}
      <p class="muted">{t("The assistant has no question: the task looks complete.")}</p>
    {:else if questions}
      <p class="muted small" style="margin-top:0">{t("Answer what you can, then let the assistant complete the task.")}</p>
      {#each questions as q, i (i)}
        <fieldset class="question">
          <legend>{q.question}</legend>
          <div class="options">
            {#each q.options as o (o)}
              <label class="option"><input type="radio" name={`q${i}`} value={o} bind:group={answers[i].choice} />{o}</label>
            {/each}
            <label class="option"><input type="radio" name={`q${i}`} value={OTHER} bind:group={answers[i].choice} />{t("Other")}</label>
            <button type="button" class="btn ghost small" onclick={() => discuss(q)}><Icon name="comment" size={16} />{t("Let's discuss it")}</button>
          </div>
          {#if answers[i].choice === OTHER}
            <input class="input" bind:value={answers[i].other} placeholder={t("Your answer")} aria-label={t("Your answer")} />
          {/if}
        </fieldset>
      {/each}
    {/if}

    {#if discussing}
      <section class="discussion" bind:this={thread}>
        <div class="label-text">{t("Discussion with the assistant")}</div>
        <div class="messages">
          {#each discussion as m, i (i)}
            <div class="message" class:mine={m.role === "user"}>{#if m.role === "assistant"}<Markdown source={m.content} />{:else}{m.content}{/if}</div>
          {/each}
          {#if busy}<div class="message muted">…</div>{/if}
        </div>
        <form class="say" onsubmit={say}>
          <textarea class="input" rows="2" bind:value={draft} placeholder={t("Your message")} aria-label={t("Your message")}></textarea>
          <button class="btn small" disabled={busy || !draft.trim()}>{t("Send")}</button>
        </form>
      </section>
    {/if}

    {#if error}<div class="error-text" role="alert">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={() => (mode = "proposal")}>{t("Back")}</button>
      {#if questions && !discussing}
        <button type="button" class="btn neutral" onclick={() => discuss()}><Icon name="comment" size={16} />{t("Let's discuss it")}</button>
      {/if}
      <button type="button" class="btn" disabled={busy || !told} onclick={propose}>{t("Complete the task with my answers")}</button>
    </div>
  {/if}
</Modal>

<style>
  .thinking { display: flex; gap: 8px; align-items: center; }
  .part { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--divider); }
  .part input { margin-top: 4px; }
  .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .before { color: var(--text-tertiary); text-decoration: line-through; overflow-wrap: anywhere; }
  .after { overflow-wrap: anywhere; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .box { display: block; max-height: 320px; overflow: auto; padding: 8px; border: 1px solid var(--divider); border-radius: 6px; font-size: 14px; }
  .before-box { color: var(--text-secondary); }
  .question { border: 0; border-top: 1px solid var(--divider); margin: 0; padding: 10px 0; display: flex; flex-direction: column; gap: 8px; }
  .question legend { font-weight: 600; padding: 10px 0 0; float: left; width: 100%; }
  .options { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; clear: both; }
  .option { display: flex; gap: 6px; align-items: center; }
  .discussion { border-top: 1px solid var(--divider); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .messages { max-height: 280px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
  .message { padding: 6px 10px; border-radius: 8px; background: var(--background-secondary); max-width: 85%; overflow-wrap: anywhere; font-size: 14px; }
  .message.mine { align-self: flex-end; background: var(--list-hover); white-space: pre-wrap; }
  .say { display: flex; gap: 8px; align-items: flex-end; }
  .say textarea { flex: 1; min-height: 0; height: 64px; }
  @media (max-width: 640px) { .cols { grid-template-columns: 1fr; } }
</style>
