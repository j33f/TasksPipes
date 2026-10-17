<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { GIT_STATE_COLOR, GIT_STATE_LABEL, branchName, gitKindLabel } from "../lib/git";
  import { relativeTime } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";
  import type { TaskLink } from "../lib/types";
  import Icon from "./Icon.svelte";

  /** The task's key, branch name and the pull/merge requests and commits naming it. */
  let { taskKey, title, links }: { taskKey: string; title: string; links: TaskLink[] } = $props();

  const branch = $derived(branchName(taskKey, title));
  const requests = $derived(links.filter((l) => l.kind !== "commit"));
  const commits = $derived(links.filter((l) => l.kind === "commit"));

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      app.toast(t("Copied: {text}", { text }));
    } catch {
      app.toast(t("Could not copy: select the link"), "error");
    }
  }
</script>

<div class="dev">
  <div class="row wrap key-row">
    <button class="chip" title={t("Name the task with its key in a branch, a pull/merge request or a commit to link them")} onclick={() => copy(taskKey)}>
      <Icon name="pipe" size={13} />{taskKey}
    </button>
    <button class="chip mono" title={t("Copy a branch name for this task")} onclick={() => copy(branch)}>
      <Icon name="branch" size={13} />{branch}
    </button>
  </div>

  {#each requests as l (l.url)}
    <a class="link" href={l.url} target="_blank" rel="noreferrer">
      <span class="state" style="background:{GIT_STATE_COLOR[l.state]}">{t(GIT_STATE_LABEL[l.state])}</span>
      <Icon name={l.state === "merged" ? "merge" : "branch"} size={15} />
      <span class="title">{l.title || gitKindLabel(l.kind)}</span>
      <span class="small muted">{l.repo}{l.number ? ` ${l.kind === "merge_request" ? "!" : "#"}${l.number}` : ""}</span>
    </a>
  {/each}
  {#if commits.length}
    <details class="commits">
      <summary class="small muted">{t("{n} linked commits", { n: commits.length })}</summary>
      {#each commits as l (l.url)}
        <a class="link small" href={l.url} target="_blank" rel="noreferrer">
          <span class="mono muted">{l.url.split("/").pop()?.slice(0, 7)}</span>
          <span class="title">{l.title}</span>
          <span class="muted">{l.author ?? ""} · {relativeTime(l.updatedAt)}</span>
        </a>
      {/each}
    </details>
  {/if}
</div>

<style>
  .key-row { gap: 6px; margin-bottom: 8px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--input-border); border-radius: 12px; padding: 2px 8px;
    background: none; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .chip:hover { color: var(--text); border-color: var(--text-tertiary); }
  .mono { font-family: var(--font-mono); }
  .link { display: flex; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 6px; color: var(--text); font-size: 14px; min-width: 0; }
  .link:hover { background: var(--list-hover); text-decoration: none; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state { color: #fff; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px; flex-shrink: 0; }
  .commits summary { cursor: pointer; margin: 6px 0 2px; }
</style>
