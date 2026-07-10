<script lang="ts">
  let {
    tone = "neutral",
    children,
  }: {
    tone?: "neutral" | "success" | "warning" | "error" | "info";
    children: import("svelte").Snippet;
  } = $props();
</script>

<span class="status-pill tone-{tone}">{@render children()}</span>

