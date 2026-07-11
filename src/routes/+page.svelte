<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    Activity,
    BarChart3,
    Bluetooth,
    BluetoothSearching,
    BookOpenCheck,
    Check,
    ChevronRight,
    CircleAlert,
    Download,
    History,
    LayoutDashboard,
    Pause,
    Play,
    ScanSearch,
    RefreshCcw,
    RotateCcw,
    Settings,
    ShieldAlert,
    SkipBack,
    SkipForward,
    Smartphone,
    Sparkles,
    TimerReset,
  } from "lucide-svelte";
  import Cube3D from "$lib/components/Cube3D.svelte";
  import CubeNet from "$lib/components/CubeNet.svelte";
  import StatusPill from "$lib/components/StatusPill.svelte";
  import TimerDisplay from "$lib/components/TimerDisplay.svelte";
  import CubeConnectionDialog from "$lib/components/CubeConnectionDialog.svelte";
  import { CONNECTION_LABELS, PHASE_LABELS, trainer } from "$lib/stores/trainer.svelte";
  import { FACES, type StickerColor } from "$lib/cube/cube";
  import { serializeSignalCalibrationProfile } from "$lib/calibration/signalProfile";
  import { exportJsonFile } from "$lib/data/jsonExport";

  type Section = "train" | "cases" | "history" | "settings";
  const colorOptions: Array<{ value: StickerColor; label: string }> = [
    { value: "white", label: "白" }, { value: "yellow", label: "黄" },
    { value: "red", label: "红" }, { value: "orange", label: "橙" },
    { value: "green", label: "绿" }, { value: "blue", label: "蓝" },
  ];

  let activeSection = $state<Section>("train");
  let show2dOverlay = $state(true);
  let deviceDialogOpen = $state(false);
  let deviceDialogAutoScan = $state(false);

  const deviceDialogBusy = $derived(
    ["scanning", "connecting", "authenticating", "synchronizing", "reconnecting"].includes(
      trainer.connection,
    ),
  );

  const connectionTone = $derived(
    trainer.connection === "ready"
      ? "success"
      : trainer.connection === "degraded"
        ? "warning"
        : [
              "scanning",
              "connecting",
              "discovering-services",
              "authenticating",
              "synchronizing",
              "reconnecting",
            ].includes(trainer.connection)
          ? "info"
        : ["disconnected", "bluetooth-unavailable", "permission-required"].includes(
              trainer.connection,
            )
          ? "error"
          : "neutral",
  );
  const connectionLabel = $derived(
    trainer.connectedDeviceName &&
      (trainer.connection === "ready" || trainer.connection === "degraded")
      ? `已连接 ${trainer.connectedDeviceName}`
      : CONNECTION_LABELS[trainer.connection],
  );

  const sessionLabel = $derived(
    {
      idle: "等待训练",
      scrambling: "引导打乱",
      ready: "等待第一步",
      running: "正在还原",
      complete: "本次完成",
      invalid: "结果无效",
    }[trainer.sessionState] ?? trainer.sessionState,
  );

  const primaryLabel = $derived(trainer.scramble.length === 0 ? "生成打乱" : "生成新打乱");
  const cubePaletteStyle = $derived(
    "--cube-white:" + trainer.stickerPalette.white + ";" +
      "--cube-yellow:" + trainer.stickerPalette.yellow + ";" +
      "--cube-red:" + trainer.stickerPalette.red + ";" +
      "--cube-orange:" + trainer.stickerPalette.orange + ";" +
      "--cube-blue:" + trainer.stickerPalette.blue + ";" +
      "--cube-green:" + trainer.stickerPalette.green + ";",
  );

  function primaryAction(): void {
    trainer.prepareScramble();
  }

  function openCubeConnection(): void {
    deviceDialogAutoScan = !trainer.connectedDeviceName && !deviceDialogBusy;
    deviceDialogOpen = true;
  }

  function closeDeviceDialog(): void {
    if (!deviceDialogBusy) deviceDialogOpen = false;
  }

  function gyroAxisInverted(axis: "X" | "Y" | "Z"): boolean {
    return axis === "X"
      ? trainer.gyroCalibration.invertX
      : axis === "Y"
        ? trainer.gyroCalibration.invertY
        : trainer.gyroCalibration.invertZ;
  }

  function gyroAxisOffset(axis: "X" | "Y" | "Z"): number {
    return axis === "X"
      ? trainer.gyroCalibration.offsetX
      : axis === "Y"
        ? trainer.gyroCalibration.offsetY
        : trainer.gyroCalibration.offsetZ;
  }

  async function downloadSavedSignalProfile(): Promise<void> {
    const profile = trainer.signalCalibrationProfile;
    if (!profile) return;
    await exportJsonFile(
      `cube-signal-profile-${profile.protocol}.json`,
      serializeSignalCalibrationProfile(profile),
    );
  }

  onMount(() => {
    void trainer.initialize();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

      if (event.code === "Space" && activeSection === "train") {
        event.preventDefault();
        primaryAction();
      }

      if (event.key.toLowerCase() === "r") trainer.reset();
      if (event.key === "Escape" && deviceDialogOpen) closeDeviceDialog();
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<svelte:head>
  <meta
    name="description"
    content="连接 GAN 智能魔方，进行 CFOP 自动分段和 Case 定向训练。"
  />
</svelte:head>

<div class="app-shell" style={cubePaletteStyle}>
  <header class="top-app-bar">
    <div class="brand">
      <span class="brand-mark"><Sparkles size={19} strokeWidth={2.4} /></span>
      <div>
        <strong>CFOP Trainer</strong>
        <span>Bluetooth cube lab</span>
      </div>
    </div>

    <div class="top-status">
      <button
        class="top-connection"
        aria-label={connectionLabel}
        title={trainer.connectionMessage}
        disabled={deviceDialogBusy}
        onclick={openCubeConnection}
      >
        <StatusPill tone={connectionTone}>
          {#if trainer.connection === "scanning"}
            <BluetoothSearching size={15} />
          {:else}
            <Bluetooth size={15} />
          {/if}
          <span>{connectionLabel}</span>
        </StatusPill>
      </button>
      <button class="icon-button" aria-label="重置当前训练" onclick={() => trainer.reset()}>
        <RotateCcw size={18} />
      </button>
    </div>
  </header>

  <nav class="navigation-rail" aria-label="主导航">
    <button class:active={activeSection === "train"} onclick={() => (activeSection = "train")}>
      <LayoutDashboard size={21} />
      <span>训练</span>
    </button>
    <button class:active={activeSection === "cases"} onclick={() => (activeSection = "cases")}>
      <BookOpenCheck size={21} />
      <span>Case</span>
    </button>
    <button class:active={activeSection === "history"} onclick={() => (activeSection = "history")}>
      <History size={21} />
      <span>历史</span>
    </button>
    <button class:active={activeSection === "settings"} onclick={() => (activeSection = "settings")}>
      <Settings size={21} />
      <span>设置</span>
    </button>
  </nav>

  <main class="content">
    {#if activeSection === "train"}
      <div class="training-layout">
        <section class="workspace-card cube-workspace">
          <div class="section-heading">
            <div>
              <span class="eyebrow">实时魔方</span>
              <h1>{PHASE_LABELS[trainer.phase]} 阶段</h1>
            </div>
            <button
              class="secondary-button"
              aria-label="切换 2D 辅助视图"
              aria-pressed={show2dOverlay}
              onclick={() => (show2dOverlay = !show2dOverlay)}
            >2D 辅助</button>
          </div>

          <div class="cube-visual-stage">
            <Cube3D
              cube={trainer.cube}
              orientation={trainer.gyroQuaternion}
              gyroCalibration={trainer.gyroCalibration}
              stickerPalette={trainer.stickerPalette}
            />
            {#if show2dOverlay}
              <aside class="cube-net-overlay" aria-label="3D 视图的 2D 辅助图">
                <span>2D</span>
                <CubeNet cube={trainer.cube} mini />
              </aside>
            {/if}
          </div>

          <div class="timer-panel">
            <TimerDisplay value={trainer.formatTime()} state={sessionLabel} />
            <div class="timer-meta">
              <StatusPill tone={trainer.hadDesync ? "warning" : "success"}>
                {#if trainer.hadDesync}<ShieldAlert size={14} /> 数据降级{:else}<Check size={14} /> 状态可信{/if}
              </StatusPill>
              <span>{trainer.eventCount} moves</span>
              <span>首步开始 · Solved 停止</span>
            </div>
          </div>

          <div class="primary-actions">
            <button class="primary-button" onclick={primaryAction}>
              <Sparkles size={19} />
              {primaryLabel}
            </button>
          </div>
        </section>

        <aside class="insight-column">
          <section class="workspace-card guide-card">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow">动作引导</span>
                <h2>打乱序列</h2>
              </div>
            </div>

            {#if trainer.scramble.length === 0}
              <div class="empty-guide">
                <TimerReset size={32} />
                <p>生成一条打乱，然后按照序列转动实体魔方。</p>
              </div>
            {:else}
              <div class="algorithm-line" aria-label="打乱公式">
                {#each trainer.scramble as move, index}
                  <span
                    class:completed={index < trainer.scrambleIndex}
                    class:current={index === trainer.scrambleIndex && trainer.sessionState === "scrambling"}
                  >{move}</span>
                {/each}
              </div>
              <div class="progress-track" aria-label="打乱进度">
                <span style={`width:${trainer.scrambleProgress * 100}%`}></span>
              </div>
              <div class="guide-next">
                <span>下一动作</span>
                <strong>{trainer.currentScrambleMove ?? "完成"}</strong>
              </div>
              {#if !trainer.connectedDeviceName}
                <div class="demo-player" aria-label="打乱演示播放器">
                  <button
                    class="icon-button"
                    aria-label="上一步"
                    disabled={trainer.scrambleIndex === 0}
                    onclick={() => trainer.demoStepBack()}
                  ><SkipBack size={18} /></button>
                  <button
                    class="player-toggle"
                    aria-label={trainer.demoPlaying ? "暂停演示" : "播放演示"}
                    onclick={() => trainer.toggleDemoPlayback()}
                  >
                    {#if trainer.demoPlaying}<Pause size={18} /> 暂停{:else}<Play size={18} /> 播放{/if}
                  </button>
                  <button
                    class="icon-button"
                    aria-label="下一步"
                    disabled={trainer.scrambleIndex >= trainer.scramble.length}
                    onclick={() => trainer.demoStepForward()}
                  ><SkipForward size={18} /></button>
                  <button class="player-reset" onclick={() => trainer.resetDemoPlayback()}>
                    <RotateCcw size={16} /> 复位
                  </button>
                </div>
              {/if}
            {/if}
          </section>

          <section class="metrics-grid">
            <article class="metric-card">
              <span>当前阶段</span>
              <strong>{PHASE_LABELS[trainer.phase]}</strong>
              <small>{trainer.facts.crossSolved ? "Cross 已稳定" : "Cross 未完成"}</small>
            </article>
            <article class="metric-card">
              <span>F2L Slots</span>
              <strong>{trainer.facts.solvedF2lSlots}/4</strong>
              <small>按 cubie 状态计算</small>
            </article>
            <article class="metric-card">
              <span>OLL</span>
              <strong>{trainer.facts.ollSolved ? "Done" : "—"}</strong>
              <small>Case index 待接入</small>
            </article>
            <article class="metric-card">
              <span>最后动作</span>
              <strong class="algorithm-value">{trainer.lastMove ?? "—"}</strong>
              <small>结构化 move event</small>
            </article>
          </section>

          <section class="workspace-card architecture-card">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow">技术闸门</span>
                <h2>真实 GAN 协议</h2>
              </div>
              <Activity size={21} />
            </div>
            <ul>
              <li><Check size={16} /> BLE transport 已隔离</li>
              <li><Check size={16} /> sequence gap / resync 状态已建模</li>
              <li><Check size={16} /> SQLite migration 已注册</li>
              <li><Check size={16} /> GAN16 ui V4 AES decoder 已接入</li>
              <li><CircleAlert size={16} /> V1/V2/V3 留待对应真机验证</li>
            </ul>
          </section>
        </aside>
      </div>
    {:else if activeSection === "cases"}
      <section class="placeholder-page">
        <BookOpenCheck size={42} />
        <span class="eyebrow">Case Library</span>
        <h1>OLL / PLL 定向训练</h1>
        <p>这里将承载 canonical pattern、推荐算法、setup 引导和单 Case 成功率。当前骨架先保证 Case 与 Algorithm 是多对多关系。</p>
        <div class="placeholder-list">
          {#each ["OLL · Sune", "OLL · Anti-Sune", "PLL · T Perm", "PLL · U Perm"] as item}
            <button>{item}<ChevronRight size={18} /></button>
          {/each}
        </div>
      </section>
    {:else if activeSection === "history"}
      <section class="placeholder-page">
        <BarChart3 size={42} />
        <span class="eyebrow">Local-first analytics</span>
        <h1>历史与弱项</h1>
        <p>数据库 migration 已包含设备、session、事件序列、desync 和识别版本字段。真实训练接入后可安全计算 PB、Ao5/Ao12 和阶段弱项。</p>
      </section>
    {:else}
      <section class="placeholder-page settings-page">
        <Settings size={42} />
        <span class="eyebrow">Adaptive settings</span>
        <h1>训练设置</h1>
        <label>
          <span>默认训练模式</span>
          <select bind:value={trainer.selectedMode}>
            <option value="full_cfop">全流程 CFOP</option>
            <option value="oll">OLL</option>
            <option value="pll">PLL</option>
          </select>
        </label>
        <label>
          <span>默认 Cross 颜色</span>
          <select
            value={trainer.crossColor}
            onchange={(event) =>
              trainer.setCrossColor(event.currentTarget.value as StickerColor)}
          >
            {#each colorOptions as option}
              <option value={option.value}>{option.label}色</option>
            {/each}
          </select>
        </label>
        <div class="platform-note"><Smartphone size={18} /> 手机训练时保持前台和屏幕常亮。</div>

        <div class="state-sync-panel">
          <div>
            <strong>重置魔方状态</strong>
            <small>实体魔方还原后，读取完整状态并清空当前训练进度。</small>
          </div>
          <button
            class="primary-button"
            disabled={!trainer.connectedDeviceName || trainer.connection === "synchronizing"}
            onclick={() => void trainer.resetAndSyncCubeState()}
          >
            <RefreshCcw size={17} />
            {trainer.connection === "synchronizing" ? "正在同步" : "重置并同步状态"}
          </button>
        </div>

        <div class="state-sync-panel signal-lab-entry">
          <div>
            <strong>魔方信号采集实验室</strong>
            <small>用六面姿态、三轴整机旋转和标准公式，反推出协议轴、方向与动作映射。</small>
          </div>
          <button
            class="primary-button"
            onclick={() => void goto("/signal-lab")}
          >
            <ScanSearch size={17} />
            开始采集
          </button>
        </div>
        {#if trainer.signalCalibrationProfile}
          <div class="saved-profile-panel">
            <div>
              <span class="eyebrow">Latest signal profile</span>
              <strong>最近一次标定 · {trainer.signalCalibrationProfile.protocol.toUpperCase()}</strong>
              <small>
                置信度 {Math.round(trainer.signalCalibrationProfile.overallConfidence * 100)}%
                · {trainer.signalCalibrationProfile.staticPoses.length}/6 姿态
                · {trainer.signalCalibrationProfile.dynamicAxes.length}/3 轴
              </small>
            </div>
            <button class="secondary-button" onclick={() => void downloadSavedSignalProfile()}>
              <Download size={17} /> 重新导出 JSON
            </button>
          </div>
        {/if}

        <div class="calibration-panel">
          <div class="calibration-heading">
            <div><span class="eyebrow">Device calibration</span><h2>颜色与陀螺仪</h2></div>
            <button class="secondary-button" onclick={() => trainer.resetGyroCalibration()}>恢复陀螺仪默认值</button>
          </div>

          <label class="toggle-row">
            <span><strong>白色 / 黄色对调</strong><small>标准配色默认 U 白、D 黄</small></span>
            <input
              type="checkbox"
              checked={trainer.whiteYellowSwapped}
              onchange={(event) => trainer.setWhiteYellowSwapped(event.currentTarget.checked)}
            />
          </label>

          <div class="face-color-grid" aria-label="六面中心色映射">
            {#each FACES as face}
              <label>
                <span class="face-chip sticker-{trainer.faceColors[face]}">{face}</span>
                <select
                  value={trainer.faceColors[face]}
                  onchange={(event) => trainer.setFaceColor(face, event.currentTarget.value as StickerColor)}
                >
                  {#each colorOptions as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>

          <div class="palette-heading">
            <div>
              <strong>贴纸显示色</strong>
              <small>默认使用全亮配色，2D 和 3D 共用</small>
            </div>
            <button class="text-button" onclick={() => trainer.resetStickerPalette()}>
              恢复全亮默认
            </button>
          </div>
          <div class="sticker-palette-grid" aria-label="贴纸显示色">
            {#each colorOptions as option}
              <label>
                <input
                  type="color"
                  aria-label={option.label + "色贴纸"}
                  value={trainer.stickerPalette[option.value]}
                  onchange={(event) =>
                    trainer.setStickerPaletteColor(option.value, event.currentTarget.value)}
                />
                <span>
                  <strong>{option.label}色</strong>
                  <code>{trainer.stickerPalette[option.value]}</code>
                </span>
              </label>
            {/each}
          </div>

          <label class="toggle-row">
            <span><strong>跟随魔方陀螺仪</strong><small>关闭后 3D 只响应手动拖拽</small></span>
            <input
              type="checkbox"
              checked={trainer.gyroCalibration.enabled}
              onchange={(event) => trainer.setGyroEnabled(event.currentTarget.checked)}
            />
          </label>

          <div class="gyro-actions">
            <button class="primary-button" disabled={!trainer.gyroQuaternion} onclick={() => trainer.zeroGyro()}>
              按当前手持姿态校准
            </button>
            {#each ["X", "Y", "Z"] as axis}
              <label class="axis-toggle">
                <input
                  type="checkbox"
                  checked={gyroAxisInverted(axis as "X" | "Y" | "Z")}
                  onchange={(event) => trainer.setGyroInverted(axis as "X" | "Y" | "Z", event.currentTarget.checked)}
                /> 反转 {axis} 轴
              </label>
            {/each}
          </div>

          <div class="gyro-offsets">
            {#each ["X", "Y", "Z"] as axis}
              <label>
                <span>{axis} 轴微调 <strong>{gyroAxisOffset(axis as "X" | "Y" | "Z")}°</strong></span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={gyroAxisOffset(axis as "X" | "Y" | "Z")}
                  oninput={(event) => trainer.setGyroOffset(axis as "X" | "Y" | "Z", Number(event.currentTarget.value))}
                />
              </label>
            {/each}
          </div>

          <div class="protocol-debug">
            <article><span>最后动作</span><strong>{trainer.lastMove ?? "—"}</strong></article>
            <article><span>Move counter</span><strong>{trainer.cubeSequence ?? "—"}</strong></article>
            <article><span>Quaternion</span><code>{trainer.gyroQuaternion ? `${trainer.gyroQuaternion.x.toFixed(3)}, ${trainer.gyroQuaternion.y.toFixed(3)}, ${trainer.gyroQuaternion.z.toFixed(3)}, ${trainer.gyroQuaternion.w.toFixed(3)}` : "等待 0xEC"}</code></article>
            <article><span>Angular velocity</span><code>{trainer.gyroVelocity ? `${trainer.gyroVelocity.x}, ${trainer.gyroVelocity.y}, ${trainer.gyroVelocity.z}` : "—"}</code></article>
          </div>
        </div>
      </section>
    {/if}
  </main>

  <nav class="bottom-navigation" aria-label="移动端主导航">
    <button class:active={activeSection === "train"} onclick={() => (activeSection = "train")}>
      <LayoutDashboard size={20} /><span>训练</span>
    </button>
    <button class:active={activeSection === "cases"} onclick={() => (activeSection = "cases")}>
      <BookOpenCheck size={20} /><span>Case</span>
    </button>
    <button class:active={activeSection === "history"} onclick={() => (activeSection = "history")}>
      <History size={20} /><span>历史</span>
    </button>
    <button class:active={activeSection === "settings"} onclick={() => (activeSection = "settings")}>
      <Settings size={20} /><span>设置</span>
    </button>
  </nav>

  {#if deviceDialogOpen}
    <CubeConnectionDialog autoScan={deviceDialogAutoScan} onclose={closeDeviceDialog} />
  {/if}

</div>

<style>
  .app-shell {
    min-height: 100vh;
    display: grid;
    grid-template: 68px 1fr / 84px 1fr;
  }

  .top-app-bar {
    position: sticky;
    top: 0;
    z-index: 20;
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    padding: 0 22px;
    border-bottom: 1px solid var(--color-top-bar-outline);
    color: var(--color-on-top-bar);
    background: rgb(23 27 28 / 0.94);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    backdrop-filter: blur(18px);
  }

  .brand,
  .top-status,
  .primary-actions,
  .timer-meta {
    display: flex;
    align-items: center;
  }

  .brand { gap: 11px; }
  .brand-mark {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 12px;
    color: var(--color-on-primary);
    background: var(--color-primary);
  }
  .brand > div { display: grid; }
  .brand strong { color: var(--color-on-top-bar); font-size: 0.95rem; letter-spacing: -0.02em; }
  .brand span:last-child { color: var(--color-on-top-bar-muted); font-size: 0.68rem; }
  .top-status { gap: 9px; }
  .top-connection {
    min-width: 0;
    padding: 0;
    border-radius: 999px;
    background: transparent;
    cursor: pointer;
  }
  .top-connection:disabled { cursor: wait; }
  .top-connection :global(.status-pill) { max-width: min(42vw, 360px); }
  .top-connection :global(.status-pill span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .top-app-bar :global(.status-pill) {
    color: var(--color-on-top-bar-muted);
    border-color: rgb(244 247 246 / 0.42);
    background: rgb(255 255 255 / 0.07);
  }
  .top-app-bar :global(.status-pill.tone-info) {
    color: #b9d9ff;
    border-color: rgb(185 217 255 / 0.52);
    background: rgb(78 143 219 / 0.14);
  }
  .top-app-bar :global(.status-pill.tone-success) {
    color: #9ff0c8;
    border-color: rgb(159 240 200 / 0.5);
    background: rgb(68 201 143 / 0.13);
  }
  .top-app-bar :global(.status-pill.tone-warning) {
    color: #ffe09a;
    border-color: rgb(255 224 154 / 0.5);
  }
  .top-app-bar :global(.status-pill.tone-error) {
    color: #ffc1bb;
    border-color: rgb(255 193 187 / 0.5);
  }

  .icon-button,
  .navigation-rail button,
  .bottom-navigation button {
    display: inline-grid;
    place-items: center;
    color: var(--color-text-muted);
    background: transparent;
    cursor: pointer;
  }
  .icon-button {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    color: var(--color-on-top-bar-muted);
  }
  .icon-button:hover { background: rgb(255 255 255 / 0.09); color: var(--color-on-top-bar); }

  .navigation-rail {
    position: sticky;
    top: 68px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: calc(100vh - 68px);
    padding: 16px 10px;
    border-right: 1px solid var(--color-outline-soft);
  }
  .navigation-rail button {
    gap: 5px;
    min-height: 58px;
    border-radius: 18px;
    font-size: 0.68rem;
  }
  .navigation-rail button:hover { background: var(--color-surface); color: var(--color-text); }
  .navigation-rail button.active {
    color: var(--color-on-primary);
    background: var(--color-primary);
  }

  .content {
    width: min(100%, 1500px);
    min-width: 0;
    margin: 0 auto;
    padding: 20px 24px 34px;
  }

  .text-button,
  .secondary-button,
  .primary-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 14px;
    border-radius: 13px;
    font-weight: 720;
    cursor: pointer;
  }
  .text-button { color: var(--color-primary); background: transparent; }
  .text-button:hover { background: rgb(135 232 188 / 0.08); }
  .text-button:disabled { cursor: wait; opacity: 0.48; }
  .primary-button { color: var(--color-on-primary); background: var(--color-primary); }
  .primary-button:hover { background: var(--color-primary-strong); }
  .secondary-button { color: var(--color-text); background: var(--color-surface-highest); }
  .secondary-button:disabled { cursor: not-allowed; opacity: 0.42; }

  .training-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(310px, 0.75fr);
    gap: 18px;
    align-items: start;
  }
  .workspace-card,
  .metric-card,
  .placeholder-page {
    border: 1px solid var(--color-outline-soft);
    background: var(--color-surface);
    box-shadow: 0 20px 50px rgb(0 0 0 / 0.12);
  }
  .workspace-card { border-radius: 24px; }
  .cube-workspace { min-height: 650px; padding: 22px; }
  .cube-visual-stage { position: relative; }
  .cube-net-overlay {
    position: absolute;
    z-index: 3;
    right: 8px;
    bottom: 12px;
    display: grid;
    justify-items: end;
    padding: 7px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 14px;
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    box-shadow: 0 12px 30px rgb(0 0 0 / 0.16);
    backdrop-filter: blur(12px);
  }
  .cube-net-overlay > span {
    padding: 0 4px;
    color: var(--color-text-muted);
    font-size: 0.58rem;
    font-weight: 850;
  }
  .section-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }
  .section-heading h1,
  .section-heading h2,
  .placeholder-page h1 { margin: 4px 0 0; letter-spacing: -0.04em; }
  .section-heading h1 { font-size: 1.55rem; }
  .section-heading h2 { font-size: 1rem; }
  .eyebrow {
    color: var(--color-primary);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .timer-panel {
    display: grid;
    gap: 13px;
    padding: 18px 12px;
    border-top: 1px solid var(--color-outline-soft);
  }
  .timer-meta { justify-content: center; flex-wrap: wrap; gap: 12px; color: var(--color-text-muted); font-size: 0.72rem; }
  .primary-actions { justify-content: center; gap: 9px; padding-top: 4px; }

  .insight-column { display: grid; gap: 14px; }
  .guide-card,
  .architecture-card { padding: 18px; }
  .compact-heading { align-items: center; }
  .empty-guide {
    display: grid;
    place-items: center;
    min-height: 150px;
    color: var(--color-text-muted);
    text-align: center;
  }
  .empty-guide p { max-width: 220px; margin: 10px 0 0; font-size: 0.82rem; }
  .algorithm-line {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    min-height: 94px;
    align-content: center;
    padding: 15px 0;
    font-family: "SFMono-Regular", Consolas, monospace;
  }
  .algorithm-line span {
    display: grid;
    min-width: 38px;
    height: 38px;
    place-items: center;
    border: 1px solid var(--color-outline-soft);
    border-radius: 10px;
    color: var(--color-text-muted);
    background: var(--color-surface-high);
  }
  .algorithm-line span.completed { color: var(--color-success); opacity: 0.62; }
  .algorithm-line span.current {
    color: var(--color-on-primary);
    border-color: var(--color-primary);
    background: var(--color-primary);
    box-shadow: 0 0 0 5px rgb(135 232 188 / 0.09);
  }
  .progress-track { height: 5px; overflow: hidden; border-radius: 99px; background: var(--color-surface-highest); }
  .progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--color-primary); transition: width 160ms ease-out; }
  .guide-next { display: flex; align-items: center; justify-content: space-between; padding-top: 14px; }
  .guide-next span { color: var(--color-text-muted); font-size: 0.74rem; }
  .guide-next strong { font: 750 1.45rem "SFMono-Regular", Consolas, monospace; }
  .demo-player {
    display: grid;
    grid-template-columns: 40px minmax(96px, 1fr) 40px auto;
    gap: 8px;
    align-items: center;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--color-outline-soft);
  }
  .demo-player button { min-height: 40px; }
  .demo-player .icon-button { border: 1px solid var(--color-outline-soft); background: var(--color-surface-high); }
  .demo-player .icon-button:disabled { cursor: default; opacity: 0.34; }
  .player-toggle,
  .player-reset {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 11px;
    color: var(--color-text);
    background: var(--color-surface-high);
  }
  .player-toggle { color: var(--color-on-primary); border-color: var(--color-primary); background: var(--color-primary); }
  .player-reset { padding-inline: 12px; color: var(--color-text-muted); }

  .metrics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .metric-card { display: grid; gap: 4px; min-height: 112px; padding: 14px; border-radius: 18px; }
  .metric-card span { color: var(--color-text-muted); font-size: 0.7rem; }
  .metric-card strong { align-self: end; font-size: 1.45rem; letter-spacing: -0.05em; }
  .metric-card small { color: var(--color-text-muted); font-size: 0.65rem; }
  .metric-card .algorithm-value { font-family: "SFMono-Regular", Consolas, monospace; }
  .architecture-card ul { display: grid; gap: 10px; margin: 16px 0 0; padding: 0; list-style: none; }
  .architecture-card li { display: flex; align-items: center; gap: 8px; color: var(--color-text-muted); font-size: 0.76rem; }
  .architecture-card li :global(svg) { flex: 0 0 auto; color: var(--color-primary); }
  .architecture-card li:last-child :global(svg) { color: var(--color-warning); }

  .placeholder-page {
    display: grid;
    justify-items: start;
    max-width: 760px;
    min-height: 480px;
    margin: 4vh auto;
    padding: clamp(28px, 7vw, 68px);
    border-radius: 28px;
  }
  .placeholder-page > :global(svg) { margin-bottom: 22px; color: var(--color-primary); }
  .placeholder-page h1 { font-size: clamp(2rem, 5vw, 3.6rem); }
  .placeholder-page p { max-width: 620px; color: var(--color-text-muted); line-height: 1.75; }
  .placeholder-list { display: grid; width: 100%; gap: 8px; margin-top: 22px; }
  .placeholder-list button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 0 16px;
    border-radius: 14px;
    color: var(--color-text);
    background: var(--color-surface-high);
    cursor: pointer;
  }
  .settings-page { gap: 14px; }
  .settings-page label { display: grid; width: 100%; max-width: 480px; gap: 8px; color: var(--color-text-muted); font-size: 0.78rem; }
  .settings-page select {
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--color-outline);
    border-radius: 12px;
    color: var(--color-text);
    background: var(--color-surface-high);
  }
  .platform-note { display: flex; gap: 8px; margin-top: 12px; color: var(--color-warning); font-size: 0.8rem; }
  .state-sync-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    margin-top: 10px;
    padding: 15px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 16px;
    background: var(--color-surface-high);
  }
  .state-sync-panel > div { display: grid; gap: 4px; }
  .state-sync-panel strong { color: var(--color-text); font-size: 0.86rem; }
  .state-sync-panel small { color: var(--color-text-muted); font-size: 0.7rem; line-height: 1.45; }
  .state-sync-panel .primary-button { flex: 0 0 auto; }
  .saved-profile-panel {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%;
    padding: 14px 15px; border: 1px solid rgb(135 232 188 / 0.24); border-radius: 16px;
    background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface-high));
  }
  .saved-profile-panel > div { display: grid; gap: 4px; }
  .saved-profile-panel strong { color: var(--color-text); font-size: 0.84rem; }
  .saved-profile-panel small { color: var(--color-text-muted); font-size: 0.7rem; }
  .saved-profile-panel .secondary-button { flex: 0 0 auto; }
  .calibration-panel { display: grid; width: 100%; gap: 16px; margin-top: 22px; padding-top: 22px; border-top: 1px solid var(--color-outline-soft); }
  .calibration-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
  .calibration-heading h2 { margin: 4px 0 0; }
  .toggle-row { display: flex !important; grid-template-columns: none !important; flex-direction: row !important; align-items: center; justify-content: space-between; max-width: none !important; gap: 18px !important; padding: 13px 14px; border-radius: 14px; background: var(--color-surface-high); }
  .toggle-row > span { display: grid; gap: 3px; }
  .toggle-row strong { color: var(--color-text); }
  .toggle-row small { color: var(--color-text-muted); }
  .toggle-row input { width: 20px; height: 20px; accent-color: var(--color-primary-strong); }
  .face-color-grid { display: grid; grid-template-columns: repeat(6, minmax(72px, 1fr)); gap: 8px; width: 100%; }
  .face-color-grid label { display: grid; min-width: 0; gap: 6px; }
  .face-color-grid select { min-height: 38px; }
  .face-chip { display: grid; height: 44px; place-items: center; border: 3px solid var(--color-cube-frame); border-radius: 9px; color: rgb(0 0 0 / 0.58); font-weight: 850; }
  .palette-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
  }
  .palette-heading > div { display: grid; gap: 3px; }
  .palette-heading strong { color: var(--color-text); font-size: 0.84rem; }
  .palette-heading small { color: var(--color-text-muted); font-size: 0.68rem; }
  .sticker-palette-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
    width: 100%;
  }
  .sticker-palette-grid label {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    max-width: none;
    padding: 9px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 13px;
    background: var(--color-surface-high);
  }
  .sticker-palette-grid input[type="color"] {
    flex: 0 0 auto;
    width: 38px;
    height: 38px;
    padding: 2px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 10px;
    background: var(--color-surface-highest);
    cursor: pointer;
  }
  .sticker-palette-grid span { display: grid; min-width: 0; gap: 2px; }
  .sticker-palette-grid strong { color: var(--color-text); font-size: 0.76rem; }
  .sticker-palette-grid code {
    overflow: hidden;
    color: var(--color-text-muted);
    font-size: 0.62rem;
    text-overflow: ellipsis;
  }
  .sticker-white { background: var(--cube-white); } .sticker-yellow { background: var(--cube-yellow); }
  .sticker-red { background: var(--cube-red); } .sticker-orange { background: var(--cube-orange); }
  .sticker-blue { background: var(--cube-blue); } .sticker-green { background: var(--cube-green); }
  .gyro-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .axis-toggle { display: inline-flex !important; width: auto !important; align-items: center; gap: 6px !important; }
  .axis-toggle input { accent-color: var(--color-primary-strong); }
  .gyro-offsets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; width: 100%; }
  .gyro-offsets label { display: grid; gap: 7px; }
  .gyro-offsets label span { display: flex; justify-content: space-between; }
  .gyro-offsets input { width: 100%; accent-color: var(--color-primary-strong); }
  .protocol-debug { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
  .protocol-debug article { display: grid; gap: 5px; min-width: 0; padding: 12px; border: 1px solid var(--color-outline-soft); border-radius: 13px; background: var(--color-surface-high); }
  .protocol-debug span { color: var(--color-text-muted); font-size: 0.68rem; }
  .protocol-debug strong { font-size: 1.1rem; }
  .protocol-debug code { overflow: hidden; color: var(--color-info); font-size: 0.7rem; text-overflow: ellipsis; white-space: nowrap; }

  .bottom-navigation { display: none; }

  @media (max-width: 1100px) {
    .training-layout { grid-template-columns: 1fr; }
    .insight-column { grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr); }
    .metrics-grid { grid-row: span 2; }
  }

  @media (max-width: 839px) {
    .app-shell { grid-template: 64px 1fr / 70px 1fr; }
    .top-app-bar { padding: 0 14px; }
    .navigation-rail { top: 64px; height: calc(100vh - 64px); padding-inline: 7px; }
    .content { padding: 14px 14px 28px; }
    .insight-column { grid-template-columns: 1fr; }
    .cube-workspace { min-height: auto; }
  }

  @media (max-width: 599px) {
    .app-shell { display: block; padding-bottom: calc(76px + env(safe-area-inset-bottom)); }
    .top-app-bar { height: 58px; padding-top: env(safe-area-inset-top); }
    .brand > div { display: none; }
    .top-connection :global(.status-pill) { max-width: min(58vw, 220px); }
    .navigation-rail { display: none; }
    .content { padding: 10px 10px 22px; }
    .calibration-heading { align-items: start; flex-direction: column; }
    .state-sync-panel { align-items: stretch; flex-direction: column; }
    .saved-profile-panel { align-items: stretch; flex-direction: column; }
    .face-color-grid { grid-template-columns: repeat(3, 1fr); }
    .palette-heading { align-items: start; flex-direction: column; }
    .sticker-palette-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gyro-offsets { grid-template-columns: 1fr; }
    .protocol-debug { grid-template-columns: 1fr; }
    .training-layout { gap: 10px; }
    .workspace-card { border-radius: 20px; }
    .cube-workspace { padding: 14px 10px; }
    .cube-net-overlay { right: 2px; bottom: 6px; transform: scale(0.82); transform-origin: right bottom; }
    .section-heading { padding-inline: 5px; }
    .section-heading h1 { font-size: 1.25rem; }
    .timer-panel { padding: 13px 4px; }
    .primary-actions { display: grid; grid-template-columns: 1fr; padding-inline: 4px; }
    .primary-button,
    .secondary-button { min-height: 50px; }
    .guide-card,
    .architecture-card { padding: 15px; }
    .demo-player { grid-template-columns: 40px minmax(88px, 1fr) 40px; }
    .player-reset { grid-column: 1 / -1; }
    .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric-card { min-height: 104px; }
    .bottom-navigation {
      position: fixed;
      inset: auto 0 0;
      z-index: 30;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      height: calc(68px + env(safe-area-inset-bottom));
      padding: 7px 7px env(safe-area-inset-bottom);
      border-top: 1px solid var(--color-outline-soft);
      background: rgb(25 29 30 / 0.94);
      backdrop-filter: blur(18px);
    }
    .bottom-navigation button { gap: 3px; border-radius: 16px; font-size: 0.65rem; }
    .bottom-navigation button.active { color: var(--color-primary); background: rgb(135 232 188 / 0.08); }
    .placeholder-page { min-height: 420px; margin: 0; padding: 30px 22px; border-radius: 20px; }
  }
</style>
