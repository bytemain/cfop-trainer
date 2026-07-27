<script lang="ts">
  import { onMount } from "svelte";
  import type { CubeState, StickerPalette } from "$lib/cube/cube";
  import { caseThumbnailDataUrl } from "$lib/cases/caseThumbnail";

  let {
    caseId,
    cube,
    palette,
  }: {
    caseId: string;
    cube: CubeState;
    palette: StickerPalette;
  } = $props();

  let img: HTMLImageElement;
  let src = $state<string | undefined>(undefined);
  let visible = false;

  function renderThumb(): void {
    src = caseThumbnailDataUrl(caseId, cube, palette);
  }

  // Thumbnails are expensive (offscreen WebGL render + PNG encode), so only
  // generate them once a card scrolls near the viewport, and defer the work
  // to idle time so list scrolling stays smooth.
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        visible = true;
        observer.disconnect();
        if ("requestIdleCallback" in window) {
          requestIdleCallback(renderThumb, { timeout: 1500 });
        } else {
          setTimeout(renderThumb, 50);
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(img);
    return () => observer.disconnect();
  });

  $effect(() => {
    palette;
    if (visible) renderThumb();
  });
</script>

<img bind:this={img} class="mini-cube" src={src} alt="" aria-hidden="true" />

<style>
  .mini-cube {
    width: 54px;
    height: 54px;
    border-radius: 10px;
    object-fit: contain;
    background:
      radial-gradient(circle at 50% 42%, rgb(135 232 188 / 0.08), transparent 60%),
      var(--color-cube-frame);
  }
</style>
