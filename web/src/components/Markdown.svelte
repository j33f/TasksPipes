<script lang="ts" module>
  import { marked } from "marked";
  import DOMPurify from "dompurify";

  marked.setOptions({ gfm: true, breaks: true });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  export const renderMarkdown = (src: string) => DOMPurify.sanitize(marked.parse(src, { async: false }) as string);
</script>

<script lang="ts">
  let { source, compact = false }: { source: string | null | undefined; compact?: boolean } = $props();
  const html = $derived(source ? renderMarkdown(source) : "");
</script>

{#if html}
  <div class="markdown" class:compact>{@html html}</div>
{/if}
