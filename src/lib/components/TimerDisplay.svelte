<script lang="ts">
  let {
    value,
    state,
  }: {
    value: string;
    state: string;
  } = $props();
</script>

<div class="timer-wrap" aria-live="polite">
  <span class="eyebrow">{state}</span>
  <strong class="timer">{value}</strong>
</div>

