<script lang="ts">
  import { FACES, type CubeState, type Face } from "$lib/cube/cube";
  import { gyroCssTransform, type GyroCalibration } from "$lib/cube/orientation";
  import type { CubeQuaternion } from "$lib/protocols/gan/types";

  let {
    cube,
    orientation = null,
    gyroCalibration,
  }: { cube: CubeState; orientation?: CubeQuaternion | null; gyroCalibration: GyroCalibration } = $props();
  const gyroTransform = $derived(gyroCssTransform(orientation, gyroCalibration) || "rotateX(0deg)");

  let rotationX = $state(-24);
  let rotationY = $state(34);
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartRotationX = 0;
  let dragStartRotationY = 0;

  function resetView(): void {
    rotationX = -24;
    rotationY = 34;
  }

  const faceTransforms: Record<Face, string> = {
    F: "rotateY(0deg) translateZ(var(--cube-half))",
    B: "rotateY(180deg) translateZ(var(--cube-half))",
    R: "rotateY(90deg) translateZ(var(--cube-half))",
    L: "rotateY(-90deg) translateZ(var(--cube-half))",
    U: "rotateX(90deg) translateZ(var(--cube-half))",
    D: "rotateX(-90deg) translateZ(var(--cube-half))",
  };

  function startDrag(event: PointerEvent): void {
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartRotationX = rotationX;
    dragStartRotationY = rotationY;
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (!dragging) return;
    rotationY = dragStartRotationY + (event.clientX - dragStartX) * 0.52;
    rotationX = dragStartRotationX - (event.clientY - dragStartY) * 0.52;
  }

  function stopDrag(event: PointerEvent): void {
    dragging = false;
    if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function rotateWithKeyboard(event: KeyboardEvent): void {
    const step = event.shiftKey ? 30 : 12;
    if (event.key === "ArrowLeft") rotationY -= step;
    else if (event.key === "ArrowRight") rotationY += step;
    else if (event.key === "ArrowUp") rotationX += step;
    else if (event.key === "ArrowDown") rotationX -= step;
    else if (event.key === "Home") resetView();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<div class="cube-3d-wrap">
  <button
    type="button"
    class:dragging
    class="cube-stage"
    aria-label="当前魔方 3D 视图。可向任意方向连续拖动翻转，双击或按 Home 恢复默认视角。"
    onpointerdown={startDrag}
    onpointermove={moveDrag}
    onpointerup={stopDrag}
    onpointercancel={stopDrag}
    onkeydown={rotateWithKeyboard}
    ondblclick={resetView}
  >
    <span class="floor-shadow" aria-hidden="true"></span>
    <span
      class="cube-object"
      class:no-transition={dragging}
      style={`--rotation-x:${rotationX}deg; --rotation-y:${rotationY}deg; --gyro-transform:${gyroTransform}`}
    >
      {#each FACES as face}
        <span class="cube-3d-face face-{face}" style={`--face-transform:${faceTransforms[face]}`}>
          <span class="face-letter" aria-hidden="true">{face}</span>
          {#each cube[face] as color, index}
            <span
              class="cube-3d-sticker sticker-{color}"
              aria-label={`${face}${index + 1} ${color}`}
            ></span>
          {/each}
        </span>
      {/each}
    </span>
  </button>
  <p>任意方向连续拖动翻转 · 双击 / Home 复位</p>
</div>

<style>
  .cube-3d-wrap {
    display: grid;
    min-height: 340px;
    place-items: center;
    align-content: center;
    gap: 8px;
    padding: 18px;
  }

  .cube-stage {
    --cube-size: clamp(168px, 22vw, 210px);
    --cube-half: calc(var(--cube-size) / 2);
    position: relative;
    display: grid;
    width: min(100%, 480px);
    height: 310px;
    place-items: center;
    padding: 0;
    overflow: visible;
    color: inherit;
    background: transparent;
    perspective: 920px;
    touch-action: none;
    cursor: grab;
    -webkit-user-select: none;
    user-select: none;
  }

  .cube-stage.dragging { cursor: grabbing; }
  .cube-stage:focus-visible { outline: none; }
  .cube-stage:focus-visible .cube-object {
    filter: drop-shadow(0 0 9px rgb(68 201 143 / 0.5));
  }

  .cube-object {
    position: relative;
    display: block;
    width: var(--cube-size);
    height: var(--cube-size);
    transform: rotateX(var(--rotation-x)) rotateY(var(--rotation-y)) var(--gyro-transform);
    transform-style: preserve-3d;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: transform;
  }

  .cube-object.no-transition { transition: none; }

  .cube-3d-face {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    gap: clamp(3px, 0.48vw, 5px);
    padding: clamp(5px, 0.72vw, 8px);
    border: 2px solid #050707;
    border-radius: 6px;
    background: #090c0c;
    box-shadow:
      inset 0 0 0 2px rgb(255 255 255 / 0.025),
      0 0 1px rgb(255 255 255 / 0.1);
    backface-visibility: hidden;
    transform: var(--face-transform);
    transform-style: preserve-3d;
  }

  .cube-3d-sticker {
    display: block;
    min-width: 0;
    border: 1px solid rgb(0 0 0 / 0.28);
    border-radius: clamp(4px, 0.55vw, 7px);
    box-shadow:
      inset 0 2px 2px rgb(255 255 255 / 0.2),
      inset 0 -2px 3px rgb(0 0 0 / 0.12);
  }

  .face-letter {
    position: absolute;
    z-index: 2;
    inset: 12px auto auto 14px;
    color: rgb(0 0 0 / 0.4);
    font-size: 0.62rem;
    font-weight: 850;
    pointer-events: none;
  }

  .sticker-white { background: var(--cube-white); }
  .sticker-yellow { background: var(--cube-yellow); }
  .sticker-red { background: var(--cube-red); }
  .sticker-orange { background: var(--cube-orange); }
  .sticker-blue { background: var(--cube-blue); }
  .sticker-green { background: var(--cube-green); }

  .floor-shadow {
    position: absolute;
    width: min(52%, 250px);
    height: 40px;
    margin-top: 265px;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.3);
    filter: blur(14px);
    transform: rotateX(67deg);
    pointer-events: none;
  }

  .cube-3d-wrap p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }

  @media (max-width: 599px) {
    .cube-3d-wrap { min-height: 276px; padding: 4px 8px 12px; }
    .cube-stage {
      --cube-size: clamp(144px, 45vw, 174px);
      height: 258px;
      perspective: 760px;
    }
    .floor-shadow { margin-top: 220px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .cube-object { transition: none; }
  }
</style>
