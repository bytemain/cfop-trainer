<script lang="ts">
  import type { CubeColor, DynamicAxisCapture } from "$lib/calibration/signalProfile";
  import { createDynamicGuideModel, rightColor } from "$lib/calibration/calibrationGuide";

  let {
    mode,
    top = "white",
    front = "green",
    physicalAxis,
    positiveFace,
    motionDirection = "clockwise",
    targetAngleDeg = 90,
  }: {
    mode: "static" | "dynamic";
    top?: CubeColor;
    front?: CubeColor;
    physicalAxis?: DynamicAxisCapture["physicalAxis"];
    positiveFace?: CubeColor;
    motionDirection?: NonNullable<DynamicAxisCapture["motionDirection"]>;
    targetAngleDeg?: 90 | 180;
  } = $props();

  const colorLabels: Record<CubeColor, string> = {
    white: "白",
    yellow: "黄",
    red: "红",
    orange: "橙",
    green: "绿",
    blue: "蓝",
  };
  const oppositeColor: Record<CubeColor, CubeColor> = {
    white: "yellow", yellow: "white", red: "orange",
    orange: "red", green: "blue", blue: "green",
  };

  const dynamicGuide = $derived(createDynamicGuideModel({
    positiveFace: positiveFace ?? "red",
    motionDirection,
    targetAngleDeg,
  }));

  const guideFront = $derived(
    mode === "dynamic"
      ? dynamicGuide.startFront
      : front,
  );
  const guideTop = $derived(
    mode === "dynamic"
      ? dynamicGuide.top
      : top,
  );
  const guideRight = $derived(rightColor(guideTop, guideFront));
  const guideBack = $derived(oppositeColor[guideFront]);
  const guideLeft = $derived(oppositeColor[guideRight]);
  const guideBottom = $derived(oppositeColor[guideTop]);
  const axisPair = $derived(
    physicalAxis === "red-orange"
      ? "红 ↔ 橙"
      : physicalAxis === "blue-green"
        ? "蓝 ↔ 绿"
        : "白 ↔ 黄",
  );
</script>

<div class="guide-card-3d" class:dynamic={mode === "dynamic"}>
  <div class="guide-scene" aria-hidden="true">
    <div class="guide-view">
      <div class="guide-turntable" style={`--guide-turn-deg: ${dynamicGuide.cssTurnDeg}deg`}>
        <div class="guide-cube">
          <div class="guide-face guide-front face-{guideFront}">
            {#each Array(9) as _, index}<i><span>{index === 4 ? colorLabels[guideFront] : ""}</span></i>{/each}
          </div>
          <div class="guide-face guide-top face-{guideTop}">
            {#each Array(9) as _, index}<i><span>{index === 4 ? colorLabels[guideTop] : ""}</span></i>{/each}
          </div>
          <div class="guide-face guide-right face-{guideRight}">
            {#each Array(9) as _, index}<i><span>{index === 4 ? colorLabels[guideRight] : ""}</span></i>{/each}
          </div>
          <div class="guide-face guide-back face-{guideBack}">
            {#each Array(9) as _, index}<i><span>{index === 4 ? colorLabels[guideBack] : ""}</span></i>{/each}
          </div>
          <div class="guide-face guide-left face-{guideLeft}">
            {#each Array(9) as _, index}<i><span>{index === 4 ? colorLabels[guideLeft] : ""}</span></i>{/each}
          </div>
          <div class="guide-face guide-bottom face-{guideBottom}">
            {#each Array(9) as _, index}<i><span>{index === 4 ? colorLabels[guideBottom] : ""}</span></i>{/each}
          </div>
        </div>
      </div>
    </div>

    {#if mode === "static"}
      <div class="top-callout"><strong>朝上</strong><span>↑</span></div>
      <div class="front-callout"><strong>朝你</strong><span>↓</span></div>
    {:else}
      <svg class="rotation-arrow" class:counterclockwise={motionDirection === "counterclockwise"} viewBox="0 0 200 200" role="img" aria-label={`从正上方看${motionDirection === "clockwise" ? "顺时针" : "逆时针"}转动整颗魔方 ${targetAngleDeg} 度`}>
        <defs>
          <marker id="guide-arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z"></path>
          </marker>
        </defs>
        <path class="arrow-track" d="M86 24 A78 78 0 1 1 59 34"></path>
        <path class="arrow-motion" marker-end="url(#guide-arrow-head)" d="M86 24 A78 78 0 1 1 59 34"></path>
      </svg>
      <div class="endpoint-label">
        <span>起点朝前 <b class="swatch face-{dynamicGuide.startFront}"></b>{colorLabels[dynamicGuide.startFront]}</span>
        <strong>→</strong>
        <span>终点朝前 <b class="swatch face-{dynamicGuide.endFront}"></b>{colorLabels[dynamicGuide.endFront]}</span>
      </div>
      <div class="turn-label"><strong>整颗魔方贴桌面</strong><span>从正上方看，像转盘一样转</span></div>
    {/if}
  </div>

  <div class="guide-caption">
    {#if mode === "static"}
      <span><b class="swatch face-{guideTop}"></b>{colorLabels[guideTop]}色中心朝上</span>
      <span><b class="swatch face-{guideFront}"></b>{colorLabels[guideFront]}色中心朝向你</span>
    {:else}
      <span><b class="swatch face-{guideTop}"></b>让{colorLabels[guideTop]}色中心朝上</span>
      <span><b class="swatch face-{dynamicGuide.startFront}"></b>开始时让{colorLabels[dynamicGuide.startFront]}色中心朝向你</span>
      <span class="axis-caption">{axisPair} 轴沿桌面法线竖直向上，整颗魔方保持贴桌面</span>
      <strong class="layer-warning">✕ 不要抬起、翻滚或拧任何单独一层</strong>
    {/if}
  </div>
</div>

<style>
  .guide-card-3d {
    display: grid; width: min(470px, 100%); justify-items: center; gap: 10px;
    padding: 12px 16px 15px; border: 1px solid var(--color-outline);
    border-radius: 20px; background:
      radial-gradient(circle at 50% 40%, rgb(135 232 188 / 0.09), transparent 52%),
      var(--color-surface-low, #15191a);
  }
  .guide-scene { position: relative; width: 310px; height: 245px; perspective: 780px; }
  .guide-view {
    --guide-size: 126px;
    position: absolute; left: 50%; top: 48%; width: var(--guide-size); height: var(--guide-size);
    transform: translate(-50%, -50%) rotateX(-23deg) rotateY(36deg);
    transform-style: preserve-3d;
  }
  .guide-turntable, .guide-cube { position: absolute; inset: 0; transform-style: preserve-3d; }
  .dynamic .guide-turntable { animation: whole-cube-turn 2.8s cubic-bezier(0.35, 0, 0.2, 1) infinite; }
  .guide-face {
    position: absolute; inset: 0; display: grid; grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr); gap: 3px; padding: 5px; border: 2px solid #060808;
    border-radius: 5px; background: #080b0b; backface-visibility: hidden;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.05);
  }
  .guide-front { transform: translateZ(calc(var(--guide-size) / 2)); }
  .guide-right { transform: rotateY(90deg) translateZ(calc(var(--guide-size) / 2)); }
  .guide-top { transform: rotateX(90deg) translateZ(calc(var(--guide-size) / 2)); }
  .guide-back { transform: rotateY(180deg) translateZ(calc(var(--guide-size) / 2)); }
  .guide-left { transform: rotateY(-90deg) translateZ(calc(var(--guide-size) / 2)); }
  .guide-bottom { transform: rotateX(-90deg) translateZ(calc(var(--guide-size) / 2)); }
  .guide-face i {
    display: grid; place-items: center; border: 1px solid rgb(0 0 0 / 0.24); border-radius: 4px;
    background: var(--guide-face-color); box-shadow: inset 0 1px 2px rgb(255 255 255 / 0.25);
    font-style: normal;
  }
  .guide-face i span { color: rgb(0 0 0 / 0.52); font-size: 0.72rem; font-weight: 900; }
  .face-white { --guide-face-color: var(--cube-white); background: var(--cube-white); }
  .face-yellow { --guide-face-color: var(--cube-yellow); background: var(--cube-yellow); }
  .face-red { --guide-face-color: var(--cube-red); background: var(--cube-red); }
  .face-orange { --guide-face-color: var(--cube-orange); background: var(--cube-orange); }
  .face-green { --guide-face-color: var(--cube-green); background: var(--cube-green); }
  .face-blue { --guide-face-color: var(--cube-blue); background: var(--cube-blue); }
  .top-callout, .front-callout {
    position: absolute; display: grid; justify-items: center; color: var(--color-primary);
    font-size: 0.68rem; font-weight: 800; letter-spacing: 0.08em;
  }
  .top-callout { top: 5px; left: 50%; transform: translateX(-50%); }
  .front-callout { bottom: 3px; left: 50%; transform: translateX(-50%); }
  .top-callout span, .front-callout span { font-size: 1.3rem; line-height: 1; }
  .rotation-arrow { position: absolute; z-index: 4; left: 50%; top: 50%; width: 205px; height: 205px; transform: translate(-50%, -50%); overflow: visible; }
  .rotation-arrow.counterclockwise { transform: translate(-50%, -50%) scaleX(-1); }
  .rotation-arrow path { fill: none; stroke-linecap: round; }
  .rotation-arrow marker path { fill: var(--color-primary); stroke: none; }
  .arrow-track { stroke: rgb(255 255 255 / 0.1); stroke-width: 5; }
  .arrow-motion {
    stroke: var(--color-primary); stroke-width: 6; stroke-dasharray: 72 420;
    animation: circle-motion 1.8s linear infinite;
    filter: drop-shadow(0 0 5px rgb(135 232 188 / 0.48));
  }
  .turn-label {
    position: absolute; z-index: 6; left: 50%; bottom: 0; display: grid; min-width: 140px;
    gap: 2px; padding: 7px 11px; border: 1px solid var(--color-outline); border-radius: 10px;
    transform: translateX(-50%); color: var(--color-text); background: rgb(17 20 21 / 0.92);
  }
  .endpoint-label {
    position: absolute; z-index: 6; left: 50%; top: 4px; display: flex; align-items: center;
    gap: 8px; min-width: max-content; padding: 6px 9px; border: 1px solid var(--color-outline);
    border-radius: 10px; transform: translateX(-50%); color: var(--color-text-muted);
    background: rgb(17 20 21 / 0.9); font-size: 0.64rem;
  }
  .endpoint-label span { display: inline-flex; align-items: center; gap: 4px; }
  .endpoint-label strong { color: var(--color-primary); }
  .turn-label strong { color: var(--color-primary); font-size: 0.72rem; }
  .turn-label span { color: var(--color-text-muted); font-size: 0.66rem; }
  .guide-caption { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 14px; color: var(--color-text-muted); font-size: 0.72rem; }
  .guide-caption span { display: inline-flex; align-items: center; gap: 6px; }
  .guide-caption .axis-caption { flex-basis: 100%; justify-content: center; color: var(--color-text); }
  .layer-warning { flex-basis: 100%; color: var(--color-error); font-size: 0.72rem; }
  .swatch { display: inline-block; width: 11px; height: 11px; border: 1px solid rgb(255 255 255 / 0.3); border-radius: 3px; }
  @keyframes circle-motion { to { stroke-dashoffset: -492; } }
  @keyframes whole-cube-turn {
    0%, 14% { transform: rotateY(0deg); }
    68%, 86% { transform: rotateY(var(--guide-turn-deg)); }
    100% { transform: rotateY(0deg); }
  }
  @media (max-width: 599px) {
    .guide-card-3d { padding-inline: 8px; }
    .guide-scene { width: 270px; height: 220px; transform: scale(0.94); }
  }
  @media (prefers-reduced-motion: reduce) { .arrow-motion, .dynamic .guide-turntable { animation: none; } }
</style>
