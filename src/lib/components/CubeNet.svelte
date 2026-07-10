<script lang="ts">
  import type { CubeState, Face } from "$lib/cube/cube";

  let { cube, compact = false }: { cube: CubeState; compact?: boolean } = $props();

  const layout: Array<{ face: Face; column: number; row: number }> = [
    { face: "U", column: 2, row: 1 },
    { face: "L", column: 1, row: 2 },
    { face: "F", column: 2, row: 2 },
    { face: "R", column: 3, row: 2 },
    { face: "B", column: 4, row: 2 },
    { face: "D", column: 2, row: 3 },
  ];
</script>

<div class:compact class="cube-net" aria-label="当前魔方 2D 展开图">
  {#each layout as item}
    <section
      class="cube-face"
      aria-label={`${item.face} 面`}
      style={`--column:${item.column}; --row:${item.row}`}
    >
      <span class="face-label">{item.face}</span>
      {#each cube[item.face] as color, index}
        <span
          class="sticker sticker-{color}"
          aria-label={`${item.face}${index + 1} ${color}`}
        ></span>
      {/each}
    </section>
  {/each}
</div>

<style>
  .cube-net {
    display: grid;
    grid-template-columns: repeat(4, minmax(56px, 92px));
    grid-template-rows: repeat(3, minmax(56px, 92px));
    gap: 8px;
    place-content: center;
    width: 100%;
    min-height: 300px;
    padding: 18px;
  }

  .cube-net.compact {
    grid-template-columns: repeat(4, minmax(45px, 72px));
    grid-template-rows: repeat(3, minmax(45px, 72px));
    min-height: 238px;
    padding: 8px;
    gap: 6px;
  }

  .cube-face {
    position: relative;
    grid-column: var(--column);
    grid-row: var(--row);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    gap: 3px;
    aspect-ratio: 1;
    padding: 4px;
    border-radius: 10px;
    background: var(--color-cube-frame);
    box-shadow: 0 5px 15px rgb(0 0 0 / 0.18);
  }

  .face-label {
    position: absolute;
    inset: 3px auto auto 4px;
    z-index: 1;
    color: rgb(0 0 0 / 0.48);
    font-size: 0.55rem;
    font-weight: 800;
    pointer-events: none;
  }

  .sticker {
    min-width: 0;
    border: 1px solid rgb(0 0 0 / 0.2);
    border-radius: 3px;
  }

  .sticker-white { background: var(--cube-white); }
  .sticker-yellow { background: var(--cube-yellow); }
  .sticker-red { background: var(--cube-red); }
  .sticker-orange { background: var(--cube-orange); }
  .sticker-blue { background: var(--cube-blue); }
  .sticker-green { background: var(--cube-green); }

  @media (max-width: 460px) {
    .cube-net {
      grid-template-columns: repeat(4, minmax(42px, 65px));
      grid-template-rows: repeat(3, minmax(42px, 65px));
      min-height: 225px;
    }
  }
</style>

