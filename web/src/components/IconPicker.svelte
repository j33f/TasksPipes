<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { PALETTE, PIPE_ICONS } from "../lib/constants";
  import Icon from "./Icon.svelte";
  import PipeIcon from "./PipeIcon.svelte";

  /** Outline-style picker: the pipe's icon is a button opening colours, icons and an emoji field. */
  let { icon, color, kind, editable = true, size = 24, onchange }: {
    icon: string | null;
    color: string | null;
    kind: string;
    editable?: boolean;
    size?: number;
    onchange: (next: { icon: string | null; color: string | null }) => void;
  } = $props();

  let open = $state(false);
  let emoji = $state("");
  let root = $state<HTMLElement>();

  const current = $derived(icon || app.pipeType(kind)?.icon || "pipe");

  const pick = (next: { icon?: string | null; color?: string | null }) => onchange({ icon, color, ...next });

  function useEmoji() {
    const first = [...new Intl.Segmenter().segment(emoji.trim())][0]?.segment;
    if (first) pick({ icon: first });
    emoji = "";
    open = false;
  }
</script>

<svelte:window onmousedown={(e) => open && root && !root.contains(e.target as Node) && (open = false)} />

<div class="icon-picker" bind:this={root}>
  <button type="button" class="trigger" class:editable disabled={!editable} title={editable ? "Changer l'icône et la couleur" : undefined}
    onclick={() => (open = !open)}>
    <PipeIcon pipe={{ icon, kind, color }} {size} />
  </button>
  {#if open}
    <div class="popover">
      <div class="swatches">
        {#each PALETTE as c (c)}
          <button type="button" class="swatch" class:selected={color === c} style="background:{c}" aria-label={c} onclick={() => pick({ color: c })}></button>
        {/each}
        <label class="swatch custom" class:selected={!!color && !PALETTE.includes(color)} title="Couleur personnalisée"
          style="background:{color && !PALETTE.includes(color) ? color : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'}">
          <input type="color" value={color ?? "#2BC2FF"} onchange={(e) => pick({ color: (e.currentTarget as HTMLInputElement).value })} />
        </label>
      </div>
      <div class="icons">
        {#each PIPE_ICONS as name (name)}
          <button type="button" class="icon-btn" class:selected={current === name} title={name} style="color:{color || 'var(--text-secondary)'}"
            onclick={() => pick({ icon: name })}><Icon {name} size={20} /></button>
        {/each}
      </div>
      <div class="row emoji-row">
        <input class="input" placeholder="Ou un emoji : 🎓" bind:value={emoji} maxlength="16"
          onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); useEmoji(); } }} />
        <button type="button" class="btn small neutral" disabled={!emoji.trim()} onclick={useEmoji}>OK</button>
      </div>
      {#if icon}
        <button type="button" class="btn ghost small reset" onclick={() => pick({ icon: null })}>Revenir à l'icône du type</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .icon-picker { position: relative; display: inline-flex; }
  .trigger { border: 0; background: none; padding: 4px; border-radius: 6px; display: inline-flex; color: inherit; }
  .trigger.editable { cursor: pointer; }
  .trigger.editable:hover { background: var(--list-hover); }
  .trigger:disabled { cursor: default; }
  .popover {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; width: 300px; padding: 12px;
    background: var(--modal-background); box-shadow: var(--menu-shadow); border-radius: 8px;
    font-size: 14px; font-weight: 400;
  }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .swatch { width: 22px; height: 22px; border-radius: 50%; border: 0; cursor: pointer; padding: 0; }
  .swatch.selected { box-shadow: 0 0 0 2px var(--modal-background), 0 0 0 4px var(--text); }
  .custom { position: relative; overflow: hidden; }
  .custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .icons { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; margin: 12px 0; }
  .icon-btn { border: 0; background: none; padding: 6px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .icon-btn:hover { background: var(--list-hover); }
  .icon-btn.selected { background: var(--background-tertiary); }
  .emoji-row .input { flex: 1; min-height: 32px; font-size: 14px; }
  .reset { margin-top: 8px; width: 100%; }
</style>
