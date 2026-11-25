<script lang="ts">
  /** Next to a person's name: done by their AI agent over MCP (`agent`: its name), or a task handed to it. */
  import { t } from "../lib/i18n.svelte";

  let { agent = null }: { agent?: string | null } = $props();
</script>

<span class="mcp-tag" title={agent ? t("Done by the AI agent “{name}”, for this person", { name: agent }) : t("This person's AI agent (MCP)")}>MCP</span>

<style>
  .mcp-tag {
    display: inline-block; margin-left: 4px; padding: 1px 4px; border-radius: 4px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.03em; line-height: 1.3; font-style: normal; vertical-align: 1px;
    background: rgb(3 102 214 / 14%); color: var(--accent); white-space: nowrap;
  }
</style>
