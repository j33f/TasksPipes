<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import Markdown from "./Markdown.svelte";
  import Avatar from "./Avatar.svelte";
  import { mentionText, typedMention, type Mentionable } from "../lib/mentions";

  let { value = $bindable(""), placeholder = t("Write in Markdown…"), rows = 6, autofocus = false, mentions }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    autofocus?: boolean;
    /** Who may be @mentioned here (people who can open the task); none: no mentions. */
    mentions?: (q: string) => Promise<Mentionable[]>;
  } = $props();

  let tab = $state<"write" | "preview">("write");
  let area = $state<HTMLTextAreaElement>();

  // @mentions: typing "@" and a few letters suggests people; Enter or Tab picks one.
  let found = $state<Mentionable[]>([]);
  let typed = $state<{ start: number; query: string } | null>(null);
  let active = $state(0);
  let seq = 0;

  async function suggest() {
    if (!mentions || !area) return;
    typed = typedMention(value, area.selectionStart);
    if (!typed) return (found = []);
    const n = ++seq;
    const people = await mentions(typed.query).catch(() => []);
    if (n === seq) {
      found = people;
      active = 0;
    }
  }

  function pick(p: Mentionable) {
    if (!typed || !area) return;
    const text = mentionText(p);
    const pos = typed.start + text.length;
    value = value.slice(0, typed.start) + text + value.slice(area.selectionStart);
    found = [];
    typed = null;
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(pos, pos);
    });
  }

  function onkeydown(e: KeyboardEvent) {
    if (!found.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(found[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      found = [];
    }
  }
</script>

<div class="md-editor">
  <div class="md-tabs">
    <button type="button" class="md-tab" class:active={tab === "write"} onclick={() => (tab = "write")}>{t("Write")}</button>
    <button type="button" class="md-tab" class:active={tab === "preview"} onclick={() => (tab = "preview")}>{t("Preview")}</button>
    <span class="spacer"></span>
    <a class="muted small hint-link" href="https://www.markdownguide.org/cheat-sheet/" target="_blank" rel="noreferrer">Markdown</a>
  </div>
  {#if tab === "write"}
    <!-- svelte-ignore a11y_autofocus -->
    <textarea class="input" {rows} {placeholder} {autofocus} bind:value bind:this={area} oninput={suggest} {onkeydown}></textarea>
    {#if found.length}
      <ul class="mentions" role="listbox" aria-label={t("People to mention")}>
        {#each found as p, i (p.id)}
          <li role="option" aria-selected={i === active}>
            <button type="button" class:active={i === active} onmousedown={(e) => { e.preventDefault(); pick(p); }}>
              <Avatar user={p} size={20} />{p.name}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="md-preview">
      {#if value}<Markdown source={value} />{:else}<span class="muted small">{t("Nothing to preview")}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .md-editor { border: 1px solid var(--input-border); border-radius: 6px; overflow: hidden; }
  .md-editor:focus-within { border-color: var(--input-border-focused); }
  .md-tabs { display: flex; gap: 2px; padding: 4px; border-bottom: 1px solid var(--divider); background: var(--background-secondary); align-items: center; }
  .md-tab { border: 0; background: none; color: var(--text-tertiary); padding: 3px 10px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; }
  .md-tab.active { background: var(--background); color: var(--text); box-shadow: var(--card-shadow); }
  .hint-link { padding-right: 6px; color: var(--text-tertiary); }
  textarea { border: 0; border-radius: 0; display: block; font-family: var(--font-mono); font-size: 13px; }
  .md-preview { padding: 10px 12px; min-height: 120px; }
  .mentions { list-style: none; margin: 0; padding: 4px; border-top: 1px solid var(--divider); max-height: 200px; overflow-y: auto; }
  .mentions button { display: flex; gap: 8px; align-items: center; width: 100%; border: 0; background: none; padding: 4px 8px; border-radius: 4px; font: inherit; font-size: 14px; color: inherit; cursor: pointer; text-align: left; }
  .mentions button.active { background: var(--background-secondary); }
</style>
