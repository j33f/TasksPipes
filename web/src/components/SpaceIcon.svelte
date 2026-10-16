<script lang="ts">
  import Avatar from "./Avatar.svelte";
  import { colorFor, initials } from "../lib/constants";

  let { space, size = 24 }: {
    space: { id: string; kind: "user" | "team"; name: string; userId?: string | null; avatarUrl?: string | null; color?: string | null };
    size?: number;
  } = $props();
</script>

{#if space.kind === "user"}
  <Avatar user={{ id: space.userId || space.id, name: space.name, avatarUrl: space.avatarUrl }} {size} />
{:else}
  <span class="team-icon" style="width:{size}px;height:{size}px;font-size:{size * 0.45}px;background:{space.color || colorFor(space.id)}">
    {initials(space.name).slice(0, 1)}
  </span>
{/if}
