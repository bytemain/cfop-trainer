<script lang="ts">
  import {
    ArrowLeft,
    BookOpenCheck,
    Check,
    ChevronRight,
    Dumbbell,
    Play,
    RotateCcw,
    Search,
    Sparkles,
  } from "lucide-svelte";
  import Cube3D from "$lib/components/Cube3D.svelte";
  import LazyCubeThumb from "$lib/components/LazyCubeThumb.svelte";
  import {
    algorithmMoves,
    familiesFor,
    filterCases,
    selectCase,
    type CaseAlgorithm,
    type CaseKind,
  } from "$lib/cases/caseLibrary";
  import { executeMoves } from "$lib/cube/algorithm";
  import { cloneCube, isSolved, type CubeState, type StickerPalette } from "$lib/cube/cube";
  import { DEFAULT_GYRO_CALIBRATION } from "$lib/cube/orientation";

  let { stickerPalette }: { stickerPalette: StickerPalette } = $props();

  let kind = $state<CaseKind>("oll");
  let query = $state("");
  let family = $state("all");
  let selectedId = $state<string | null>("oll-27");
  let practiceId = $state<string | null>(null);
  let mobileDetailOpen = $state(false);

  // 3D preview state: the selected case cube, optionally mid-playback of one
  // of its algorithms. Cube3D animates every move fed through previewMove.
  let previewCube = $state<CubeState | null>(null);
  let previewSerial = $state(0);
  let previewMove = $state<string | null>(null);
  let playbackTimer: ReturnType<typeof setInterval> | null = null;
  let playingAlgorithmId = $state<string | null>(null);
  let playbackDone = $state(false);

  const families = $derived(familiesFor(kind));
  const visibleCases = $derived(filterCases({ kind, query, family }));
  const selected = $derived(selectCase(selectedId, visibleCases));
  const practicing = $derived(selected?.id === practiceId);
  const activeCube = $derived(previewCube ?? selected?.cube ?? null);
  const playbackState = $derived(
    playbackDone && activeCube
      ? isSolved(activeCube)
        ? "solved"
        : activeCube.U.every((color) => color === activeCube.U[4])
          ? "oriented"
          : ""
      : "",
  );

  function selectKind(next: CaseKind): void {
    kind = next;
    family = "all";
    selectedId = null;
    practiceId = null;
    mobileDetailOpen = false;
    resetPreview();
  }

  function chooseCase(id: string): void {
    selectedId = id;
    practiceId = null;
    mobileDetailOpen = true;
  }

  function beginPractice(): void {
    if (selected) practiceId = selected.id;
  }

  function stopPlayback(): void {
    if (playbackTimer !== null) clearInterval(playbackTimer);
    playbackTimer = null;
    playingAlgorithmId = null;
  }

  function resetPreview(): void {
    stopPlayback();
    previewCube = null;
    previewMove = null;
    playbackDone = false;
  }

  function playAlgorithm(algorithm: CaseAlgorithm): void {
    if (!selected) return;
    stopPlayback();
    const tokens = algorithmMoves(algorithm);
    previewCube = cloneCube(selected.cube);
    playbackDone = false;
    playingAlgorithmId = algorithm.id;
    let index = 0;
    playbackTimer = setInterval(() => {
      if (!previewCube || index >= tokens.length) {
        stopPlayback();
        playbackDone = true;
        return;
      }
      previewMove = tokens[index];
      previewSerial += 1;
      previewCube = executeMoves(previewCube, [tokens[index]]);
      index += 1;
      if (index >= tokens.length) {
        stopPlayback();
        playbackDone = true;
      }
    }, 430);
  }

  // Switching cases always returns to the canonical diagram.
  $effect(() => {
    selected?.id;
    resetPreview();
  });
</script>

<section class="case-library" class:mobile-detail-open={mobileDetailOpen} aria-labelledby="case-library-title">
  <header class="library-header">
    <div class="library-title">
      <span class="library-icon"><BookOpenCheck size={24} /></span>
      <div>
        <span class="eyebrow">Case Library</span>
        <h1 id="case-library-title">CFOP Case 定向训练</h1>
        <p>57 个 OLL 与 21 个 PLL 全集。图案由公式逆运算推导，播放公式即可观看 3D 还原过程。当前练习入口仅保存本地准备状态，不生成真机成绩。</p>
      </div>
    </div>
    <div class="kind-switch" aria-label="Case 分类">
      <button class:active={kind === "oll"} aria-pressed={kind === "oll"} onclick={() => selectKind("oll")}>OLL</button>
      <button class:active={kind === "pll"} aria-pressed={kind === "pll"} onclick={() => selectKind("pll")}>PLL</button>
      <button class:active={kind === "f2l"} aria-pressed={kind === "f2l"} onclick={() => selectKind("f2l")}>F2L</button>
    </div>
  </header>

  <div class="library-toolbar">
    <label class="search-field">
      <span class="sr-only">搜索 Case、别名或公式</span>
      <Search size={18} aria-hidden="true" />
      <input bind:value={query} type="search" placeholder="搜索名称、别名、识别特征或公式" />
    </label>
    <label class="family-filter">
      <span>类型</span>
      <select bind:value={family} aria-label="按 Case 类型筛选">
        <option value="all">全部类型</option>
        {#each families as option}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>
    <span class="result-count" aria-live="polite">{visibleCases.length} 个 Case</span>
  </div>

  <div class="library-layout">
    <div class="case-list" aria-label={`${kind.toUpperCase()} Case 列表`}>
      {#if visibleCases.length === 0}
        <div class="empty-results">
          <Search size={28} />
          <strong>没有匹配的 Case</strong>
          <span>尝试清空搜索词或切换类型。</span>
          <button onclick={() => { query = ""; family = "all"; }}>清空筛选</button>
        </div>
      {:else}
        {#each visibleCases as item (item.id)}
          <button
            class="case-card"
            class:selected={selected?.id === item.id}
            aria-pressed={selected?.id === item.id}
            aria-label={`查看 ${item.kind.toUpperCase()} ${item.number} ${item.name}`}
            onclick={() => chooseCase(item.id)}
          >
            <span class="case-index">{item.kind.toUpperCase()} {item.number}</span>
            <LazyCubeThumb caseId={item.id} cube={item.cube} palette={stickerPalette} />
            <span class="case-card-copy">
              <strong>{item.name}</strong>
              <small>{item.family} · {item.tags.slice(0, 2).join(" · ")}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        {/each}
      {/if}
    </div>

    <aside class="case-detail" aria-live="polite">
      {#if selected && activeCube}
        <button class="mobile-back" onclick={() => (mobileDetailOpen = false)}><ArrowLeft size={17} /> 返回 Case 列表</button>
        <div class="detail-heading">
          <div>
            <span class="eyebrow">{selected.kind.toUpperCase()} {selected.number} · {selected.family}</span>
            <h2>{selected.name}</h2>
            {#if selected.aliases.length > 0}<p>也叫 {selected.aliases.join(" / ")}</p>{/if}
          </div>
          <span class="verified-badge"><Check size={14} /> 公式推导图案</span>
        </div>

        <div class="pattern-and-hint">
          <figure class="case-pattern" aria-label={`${selected.name} 标准图案，黄色顶面朝上，绿色面朝前`}>
            <div class="orientation-label"><span>U 黄</span><span>F 绿</span></div>
            <Cube3D
              cube={activeCube}
              orientation={null}
              gyroCalibration={DEFAULT_GYRO_CALIBRATION}
              {stickerPalette}
              interactive
              moveSerial={previewSerial}
              lastMove={previewMove}
            />
            <figcaption>
              黄色朝上 · 绿色朝前 · 拖动旋转观察
              {#if previewCube || playbackDone}
                <button class="reset-preview" onclick={resetPreview}><RotateCcw size={13} /> 恢复 Case 图案</button>
              {/if}
              {#if playbackState === "solved"}<span class="playback-result">✓ 已还原</span>
              {:else if playbackState === "oriented"}<span class="playback-result">✓ 顶面定向完成</span>{/if}
            </figcaption>
          </figure>

          <div class="recognition-card">
            <span><Sparkles size={16} /> 识别提示</span>
            <p>{selected.recognition}</p>
            <div class="tag-list" aria-label="Case 标签">
              {#each selected.tags as tag}<span>{tag}</span>{/each}
            </div>
          </div>
        </div>

        <section class="algorithms" aria-labelledby="algorithm-title">
          <div class="section-title">
            <div><span class="eyebrow">Algorithms</span><h3 id="algorithm-title">推荐公式</h3></div>
            <span>{selected.algorithms.length} 个版本 · 可播放</span>
          </div>
          {#each selected.algorithms as algorithm, algorithmIndex}
            {@const isPlaying = playingAlgorithmId === algorithm.id}
            <article class="algorithm-card" class:playing={isPlaying}>
              <div class="algorithm-meta">
                <strong>{algorithmIndex + 1}. {algorithm.label}</strong>
                <span class="algorithm-meta-right">
                  <span>{algorithmMoves(algorithm).length} moves</span>
                  <button
                    class="play-algorithm"
                    disabled={playingAlgorithmId !== null && !isPlaying}
                    onclick={() => playAlgorithm(algorithm)}
                  >
                    {#if isPlaying}<RotateCcw size={14} /> 播放中…{:else}<Play size={14} /> 播放{/if}
                  </button>
                </span>
              </div>
              <div class="algorithm-segments" aria-label={`${algorithm.label} 公式`}>
                {#each algorithm.segments as segment}
                  <code>{segment}</code>
                {/each}
              </div>
              {#if algorithm.note}<small>{algorithm.note}</small>{/if}
            </article>
          {/each}
        </section>

        <div class="practice-panel" class:active={practicing}>
          <div>
            <span class="practice-icon">{#if practicing}<Dumbbell size={20} />{:else}<Play size={20} />{/if}</span>
            <span>
              <strong>{practicing ? `${selected.name} 练习准备中` : `练习 ${selected.name}`}</strong>
              <small>{practicing ? "本地 UI 状态 · 不计时、不写入成绩" : "下一步将接入 setup 引导与实体状态校验"}</small>
            </span>
          </div>
          {#if practicing}
            <button class="secondary-action" onclick={() => (practiceId = null)}><RotateCcw size={17} /> 退出准备</button>
          {:else}
            <button class="primary-action" onclick={beginPractice}><Play size={17} /> 开始练习</button>
          {/if}
        </div>
      {:else}
        <div class="no-selection">选择一个 Case 查看图案、识别提示和公式。</div>
      {/if}
    </aside>
  </div>
</section>

<style>
  .case-library { display: grid; min-width: 0; gap: 18px; }
  .library-header,
  .library-toolbar,
  .detail-heading,
  .section-title,
  .practice-panel,
  .practice-panel > div,
  .library-title { display: flex; align-items: center; }
  .library-header { justify-content: space-between; gap: 22px; padding: 4px 2px; }
  .library-title { align-items: flex-start; gap: 14px; min-width: 0; }
  .library-icon { display: grid; flex: 0 0 auto; width: 48px; height: 48px; place-items: center; border-radius: 15px; color: var(--color-on-primary); background: var(--color-primary); }
  h1, h2, h3, p { margin: 0; }
  h1 { margin-top: 4px; font-size: clamp(1.75rem, 4vw, 2.8rem); letter-spacing: -0.045em; }
  .library-title p { max-width: 680px; margin-top: 7px; color: var(--color-text-muted); font-size: 0.78rem; line-height: 1.55; }
  .eyebrow { color: var(--color-primary); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
  .kind-switch { display: flex; flex: 0 0 auto; gap: 4px; padding: 4px; border-radius: 14px; background: var(--color-surface-high); }
  .kind-switch button { min-width: 76px; min-height: 42px; border-radius: 11px; color: var(--color-text-muted); background: transparent; cursor: pointer; }
  .kind-switch button.active { color: var(--color-on-primary); background: var(--color-primary); }

  .library-toolbar { gap: 10px; min-width: 0; padding: 11px; border: 1px solid var(--color-outline-soft); border-radius: 18px; background: var(--color-surface); }
  .search-field { display: flex; align-items: center; flex: 1 1 360px; min-width: 180px; gap: 9px; min-height: 46px; padding: 0 13px; border: 1px solid var(--color-outline-soft); border-radius: 13px; color: var(--color-text-muted); background: var(--color-surface-high); }
  .search-field:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgb(135 232 188 / 0.12); }
  .search-field input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--color-text); background: transparent; font: inherit; }
  .search-field input::placeholder { color: var(--color-text-muted); }
  .family-filter { display: flex; align-items: center; flex: 0 1 260px; gap: 8px; color: var(--color-text-muted); font-size: 0.72rem; }
  .family-filter select { min-width: 130px; min-height: 46px; padding: 0 34px 0 12px; border: 1px solid var(--color-outline-soft); border-radius: 13px; color: var(--color-text); background: var(--color-surface-high); }
  .result-count { flex: 0 0 auto; color: var(--color-text-muted); font-size: 0.72rem; }

  .library-layout { display: grid; grid-template-columns: minmax(280px, 0.72fr) minmax(0, 1.5fr); min-width: 0; gap: 14px; align-items: start; }
  .case-list,
  .case-detail { min-width: 0; border: 1px solid var(--color-outline-soft); border-radius: 22px; background: var(--color-surface); box-shadow: 0 20px 50px rgb(0 0 0 / 0.1); }
  .case-list { display: grid; align-content: start; gap: 7px; max-height: calc(100vh - 250px); min-height: 560px; overflow-y: auto; padding: 10px; }
  .case-card { display: grid; grid-template-columns: 56px 56px minmax(0, 1fr) 20px; align-items: center; gap: 10px; min-width: 0; min-height: 72px; padding: 9px 10px; border: 1px solid transparent; border-radius: 15px; color: var(--color-text); text-align: left; background: transparent; cursor: pointer; }
  .case-card:hover { background: var(--color-surface-high); }
  .case-card.selected { border-color: rgb(135 232 188 / 0.35); background: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface-high)); }
  .case-index { color: var(--color-primary); font-size: 0.68rem; font-weight: 800; }
  .case-card-copy { display: grid; min-width: 0; gap: 4px; }
  .case-card-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .case-card-copy small { overflow: hidden; color: var(--color-text-muted); font-size: 0.65rem; text-overflow: ellipsis; white-space: nowrap; }
  .case-card > :global(svg) { color: var(--color-text-muted); }
  .empty-results { display: grid; place-items: center; align-content: center; min-height: 420px; gap: 9px; color: var(--color-text-muted); text-align: center; }
  .empty-results strong { color: var(--color-text); }
  .empty-results span { font-size: 0.75rem; }
  .empty-results button { min-height: 44px; padding: 0 14px; border-radius: 12px; color: var(--color-primary); background: var(--color-surface-high); cursor: pointer; }

  .case-detail { display: grid; gap: 20px; padding: 22px; }
  .mobile-back { display: none; align-items: center; width: max-content; gap: 7px; min-height: 44px; padding: 0 10px; border-radius: 11px; color: var(--color-primary); background: var(--color-surface-high); cursor: pointer; }
  .detail-heading { justify-content: space-between; align-items: flex-start; gap: 14px; }
  .detail-heading h2 { margin-top: 4px; font-size: clamp(1.65rem, 3vw, 2.3rem); letter-spacing: -0.04em; }
  .detail-heading p { margin-top: 5px; color: var(--color-text-muted); font-size: 0.72rem; }
  .verified-badge { display: inline-flex; align-items: center; flex: 0 0 auto; gap: 5px; min-height: 30px; padding: 0 9px; border: 1px solid rgb(114 215 167 / 0.35); border-radius: 999px; color: var(--color-success); font-size: 0.68rem; }
  .pattern-and-hint { display: grid; grid-template-columns: minmax(240px, 0.9fr) minmax(240px, 1.1fr); gap: 14px; }
  .case-pattern { display: grid; justify-items: center; min-width: 0; margin: 0; padding: 10px 12px 12px; border-radius: 18px; background: var(--color-surface-high); }
  .case-pattern :global(.cube-3d-wrap) { width: 100%; min-height: 280px; padding: 0; }
  .case-pattern :global(.cube-stage) { width: 100%; height: 260px; }
  .case-pattern :global(.cube-3d-wrap > p) { display: none; }
  .orientation-label { display: flex; justify-content: space-between; width: min(100%, 240px); margin-bottom: 2px; color: var(--color-text-muted); font-size: 0.62rem; font-weight: 750; }
  .case-pattern figcaption { display: grid; justify-items: center; gap: 6px; margin-top: 4px; color: var(--color-text-muted); font-size: 0.62rem; text-align: center; }
  .reset-preview { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 10px; border-radius: 9px; color: var(--color-primary); background: var(--color-surface-highest); cursor: pointer; }
  .playback-result { color: var(--color-success); font-weight: 800; }
  .recognition-card { display: grid; align-content: start; gap: 11px; padding: 18px; border: 1px solid var(--color-outline-soft); border-radius: 18px; }
  .recognition-card > span { display: flex; align-items: center; gap: 7px; color: var(--color-primary); font-size: 0.72rem; font-weight: 800; }
  .recognition-card p { color: var(--color-text); font-size: 0.86rem; line-height: 1.7; }
  .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag-list span { padding: 5px 8px; border-radius: 999px; color: var(--color-text-muted); background: var(--color-surface-high); font-size: 0.62rem; }

  .algorithms { display: grid; gap: 9px; }
  .section-title { justify-content: space-between; }
  .section-title h3 { margin-top: 3px; font-size: 1.05rem; }
  .section-title > span { color: var(--color-text-muted); font-size: 0.7rem; }
  .algorithm-card { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--color-outline-soft); border-radius: 15px; background: var(--color-surface-high); }
  .algorithm-card.playing { border-color: rgb(135 232 188 / 0.4); background: color-mix(in srgb, var(--color-primary) 7%, var(--color-surface-high)); }
  .algorithm-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .algorithm-meta strong { font-size: 0.78rem; }
  .algorithm-meta-right { display: flex; align-items: center; gap: 10px; }
  .algorithm-meta span, .algorithm-card small { color: var(--color-text-muted); font-size: 0.64rem; }
  .play-algorithm { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 11px; border-radius: 9px; color: var(--color-on-primary); background: var(--color-primary); font-size: 0.68rem; font-weight: 800; cursor: pointer; }
  .play-algorithm:disabled { opacity: 0.45; cursor: default; }
  .algorithm-segments { display: flex; flex-wrap: wrap; gap: 7px; }
  .algorithm-segments code { min-width: 0; padding: 8px 9px; border: 1px solid var(--color-outline-soft); border-radius: 9px; color: var(--color-text); background: var(--color-surface); font: 700 0.78rem/1.4 "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }

  .practice-panel { justify-content: space-between; gap: 14px; padding: 14px; border: 1px solid var(--color-outline-soft); border-radius: 17px; background: var(--color-surface-high); }
  .practice-panel.active { border-color: rgb(135 232 188 / 0.38); background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface-high)); }
  .practice-panel > div { min-width: 0; gap: 10px; }
  .practice-icon { display: grid; flex: 0 0 auto; width: 40px; height: 40px; place-items: center; border-radius: 12px; color: var(--color-primary); background: var(--color-surface-highest); }
  .practice-panel > div > span:last-child { display: grid; min-width: 0; gap: 3px; }
  .practice-panel strong { font-size: 0.8rem; }
  .practice-panel small { color: var(--color-text-muted); font-size: 0.64rem; line-height: 1.4; }
  .primary-action, .secondary-action { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: 7px; min-height: 44px; padding: 0 13px; border-radius: 12px; font-weight: 750; cursor: pointer; }
  .primary-action { color: var(--color-on-primary); background: var(--color-primary); }
  .secondary-action { color: var(--color-text); background: var(--color-surface-highest); }
  .no-selection { display: grid; min-height: 480px; place-items: center; color: var(--color-text-muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }

  @media (max-width: 1050px) {
    .library-layout { grid-template-columns: minmax(250px, 0.7fr) minmax(0, 1.3fr); }
    .pattern-and-hint { grid-template-columns: 1fr; }
  }

  @media (max-width: 839px) {
    .library-header { align-items: flex-start; flex-direction: column; }
    .kind-switch { width: 100%; }
    .kind-switch button { flex: 1; }
    .library-toolbar { flex-wrap: wrap; }
    .search-field { flex-basis: 100%; }
    .family-filter { flex: 1 1 auto; }
    .library-layout { grid-template-columns: 1fr; }
    .case-list { grid-template-columns: repeat(2, minmax(0, 1fr)); max-height: none; min-height: 0; overflow: visible; }
    .case-card { grid-template-columns: 50px 50px minmax(0, 1fr); }
    .case-card > :global(svg) { display: none; }
  }

  @media (max-width: 599px) {
    .case-library { gap: 12px; }
    .library-header { padding-inline: 5px; }
    .library-title { gap: 10px; }
    .library-icon { width: 42px; height: 42px; border-radius: 13px; }
    h1 { font-size: 1.65rem; }
    .library-title p { font-size: 0.72rem; }
    .library-toolbar { padding: 8px; border-radius: 16px; }
    .family-filter { justify-content: space-between; width: 100%; }
    .family-filter select { flex: 1; }
    .result-count { width: 100%; padding: 0 4px 3px; }
    .case-list { grid-template-columns: 1fr; padding: 7px; border-radius: 18px; }
    .case-detail { display: none; }
    .case-library.mobile-detail-open .case-list { display: none; }
    .case-library.mobile-detail-open .case-detail { display: grid; }
    .mobile-back { display: inline-flex; }
    .case-card { min-height: 68px; }
    .case-detail { gap: 16px; padding: 15px; border-radius: 18px; }
    .detail-heading { align-items: flex-start; flex-direction: column; }
    .pattern-and-hint { grid-template-columns: minmax(0, 1fr); }
    .practice-panel { align-items: stretch; flex-direction: column; }
    .primary-action, .secondary-action { width: 100%; min-height: 48px; }
  }
</style>
