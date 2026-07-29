<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    Activity,
    BarChart3,
    Battery,
    Bluetooth,
    BluetoothSearching,
    BookOpenCheck,
    Check,
    CircleAlert,
    Compass,
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
  import CalibrationGuide3D from "$lib/components/CalibrationGuide3D.svelte";
  import CaseLibrary from "$lib/components/CaseLibrary.svelte";
  import {
    CONNECTION_LABELS,
    GAN_V4_VALIDATION_STEPS,
    PHASE_LABELS,
    trainer,
  } from "$lib/stores/trainer.svelte";
  import { FACES, type StickerColor } from "$lib/cube/cube";
  import { VIEW_PRESETS } from "$lib/cube/viewPresets";
  import { serializeSignalCalibrationProfile } from "$lib/calibration/signalProfile";
  import { exportJsonFile } from "$lib/data/jsonExport";
  import { streamRecorder, type StreamLogInfo } from "$lib/logging/streamRecorder";

  type Section = "train" | "cases" | "history" | "settings";
  const colorOptions: Array<{ value: StickerColor; label: string }> = [
    { value: "white", label: "白" }, { value: "yellow", label: "黄" },
    { value: "red", label: "红" }, { value: "orange", label: "橙" },
    { value: "green", label: "绿" }, { value: "blue", label: "蓝" },
  ];

  let activeSection = $state<Section>("train");
  let show2dOverlay = $state(true);
  let streamLogInfo = $state<StreamLogInfo | null>(null);
  let deviceDialogOpen = $state(false);
  let deviceDialogAutoScan = $state(false);
  let replayIndex = $state(0);
  let signalReprocessStatus = $state("");
  let quickCalibrationOpen = $state(false);
  let quickCalibrationStatus = $state("");
  let quickCalibrationSyncing = $state(false);
  let poseClockNow = $state(Date.now());
  const replayCube = $derived(trainer.reconstruction.replayStates[replayIndex] ?? trainer.cube);
  const poseStreamAgeMs = $derived(
    trainer.poseHealth.lastAcceptedAt === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, poseClockNow - trainer.poseHealth.lastAcceptedAt),
  );
  const poseStreamFresh = $derived(poseStreamAgeMs <= 1_500);
  // The cube stops emitting pose frames when stationary but keeps broadcasting
  // 0xED snapshots, so a stale pose with a fresh snapshot heartbeat means
  // "still", not "interrupted"; the last pose stays valid while stationary.
  const snapshotStreamFresh = $derived(
    trainer.lastSnapshotAt !== null &&
      Math.max(0, poseClockNow - trainer.lastSnapshotAt) <= 4_000,
  );
  const poseStreamState = $derived(
    poseStreamFresh ? "live" : snapshotStreamFresh ? "still" : "stale",
  );
  const quickCalibrationReady = $derived(
    Boolean(trainer.connectedDeviceName) &&
    Boolean(trainer.gyroQuaternion) &&
    trainer.gyroCalibration.enabled &&
    poseStreamFresh &&
    trainer.poseHealth.lastStepDeg !== null &&
    trainer.poseHealth.lastStepDeg <= 1.5,
  );

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
  const batteryTone = $derived(
    trainer.battery === null
      ? "neutral"
      : trainer.battery <= 5
        ? "error"
        : trainer.battery <= 20
          ? "warning"
          : "success",
  );
  const batteryLabel = $derived(
    trainer.battery === null ? "电量 —" : `电量 ${trainer.battery}%`,
  );
  const poseStreamTone = $derived(
    poseStreamFresh ? "success" : poseStreamState === "still" ? "neutral" : "warning",
  );
  const poseStreamLatencyLabel = $derived(
    `${Math.min(999, Math.max(0, Math.round(poseStreamAgeMs)))}ms`,
  );
  const formatPoseAge = (ms: number): string => {
    const seconds = ms / 1_000;
    if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${minutes.toFixed(0)} 分钟`;
    return `${(minutes / 60).toFixed(1)} 小时`;
  };
  const poseStreamStaleLabel = $derived(
    !Number.isFinite(poseStreamAgeMs)
      ? "姿态等待"
      : poseStreamState === "still"
        ? "姿态静止 · 保持最后姿态"
        : `姿态中断 · ${formatPoseAge(poseStreamAgeMs)}`,
  );
  const poseStreamCompactLabel = $derived(
    !Number.isFinite(poseStreamAgeMs)
      ? "—"
      : poseStreamState === "still"
        ? "静止"
        : formatPoseAge(poseStreamAgeMs),
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

  async function openCubeConnection(): Promise<void> {
    if (trainer.connectedDeviceName) {
      deviceDialogAutoScan = false;
      deviceDialogOpen = true;
      return;
    }
    if (deviceDialogBusy) return;
    deviceDialogAutoScan = false;
    await trainer.scanRealDevices();
    if (trainer.connection !== "ready" && trainer.connection !== "degraded") {
      deviceDialogOpen = true;
    }
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

  function reprocessSavedSignalProfile(): void {
    signalReprocessStatus = trainer.reprocessSavedSignalCalibration()
      ? "已用完整 SO(3) Pose Graph 重新求解并应用；旧的手动轴反转和偏移也已清除，无需重新采集。"
      : "现有档案仍不足以得到可靠模型，请进入采集实验室补充姿态。";
  }

  async function downloadProtocolValidationReport(): Promise<void> {
    await exportJsonFile(
      `gan-v4-protocol-validation-${Date.now()}.json`,
      JSON.stringify(trainer.protocolValidationReport(), null, 2),
    );
  }

  async function completeProtocolValidationStep(forceMismatch = false): Promise<void> {
    const result = trainer.completeProtocolValidationStep(forceMismatch);
    if (result === "mismatch" || trainer.protocolSelfTest.status === "complete") {
      await downloadProtocolValidationReport();
    }
  }

  function openQuickCalibration(): void {
    quickCalibrationStatus = "";
    quickCalibrationOpen = true;
  }

  async function runQuickCalibration(stateMode: "read-device" | "write-solved"): Promise<void> {
    if (!quickCalibrationReady || quickCalibrationSyncing) return;
    quickCalibrationSyncing = true;
    if (!trainer.quickCalibrateWhiteUpGreenFront()) {
      quickCalibrationStatus = "姿态校准失败，请确认魔方已连接、稳定且陀螺仪跟随已开启。";
      quickCalibrationSyncing = false;
      return;
    }

    const stateSynced = stateMode === "write-solved"
      ? await trainer.assumeSolvedCubeState()
      : await trainer.resetAndSyncCubeState();
    quickCalibrationSyncing = false;
    quickCalibrationStatus = stateSynced
      ? stateMode === "write-solved"
        ? "姿态已校准，复原 cubie state 已写入 GAN 并通过 0xED 回读校验。"
        : "姿态已校准，并从 GAN 同步当前完整六面。"
      : stateMode === "write-solved"
        ? "姿态已校准，但 GAN 复原状态写入或回读校验失败。"
        : "姿态已校准，但当前六面读取失败，请保持连接后重试。";
    if (stateSynced) quickCalibrationOpen = false;
  }

  onMount(() => {
    void trainer.initialize();
    void streamRecorder.info().then((info) => (streamLogInfo = info));
    const poseClock = window.setInterval(() => (poseClockNow = Date.now()), 400);
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

      if (event.code === "Space" && activeSection === "train") {
        event.preventDefault();
        primaryAction();
      }

      if (event.key.toLowerCase() === "r") trainer.reset();
      if (event.key.toLowerCase() === "c" && trainer.connectedDeviceName && trainer.gyroQuaternion) {
        trainer.zeroGyro();
      }
      if (event.key === "Escape" && deviceDialogOpen) closeDeviceDialog();
      if (event.key === "Escape" && quickCalibrationOpen) quickCalibrationOpen = false;
    };

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.clearInterval(poseClock);
      window.removeEventListener("keydown", handleKeydown);
    };
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
        onclick={() => void openCubeConnection()}
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
      {#if trainer.connectedDeviceName}
        <div class="top-telemetry" aria-label="魔方连接健康">
          <StatusPill tone={batteryTone}>
            <Battery size={15} />
            <span class="telemetry-full">{batteryLabel}</span>
            <span class="telemetry-compact">{trainer.battery === null ? "—" : `${trainer.battery}%`}</span>
          </StatusPill>
          {#if trainer.gyroCalibration.enabled}
            <StatusPill tone={poseStreamTone}>
              {#if poseStreamFresh}
                <Activity size={15} />
              {:else if poseStreamState === "still"}
                <Pause size={15} />
              {:else}
                <CircleAlert size={15} />
              {/if}
              {#if poseStreamFresh}
                <span class="telemetry-full">姿态实时 · <span class="pose-latency">{poseStreamLatencyLabel}</span></span>
                <span class="telemetry-compact pose-latency">{poseStreamLatencyLabel}</span>
              {:else}
                <span class="telemetry-full">{poseStreamStaleLabel}</span>
                <span class="telemetry-compact">{poseStreamCompactLabel}</span>
              {/if}
            </StatusPill>
          {/if}
        </div>
      {/if}
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
            <div class="section-actions">
              <button
                class="secondary-button"
                disabled={!trainer.connectedDeviceName || !trainer.gyroQuaternion}
                onclick={openQuickCalibration}
              ><RefreshCcw size={16} /> 快速校准魔方</button>
              <button
                class="secondary-button"
                aria-label="切换 2D 辅助视图"
                aria-pressed={show2dOverlay}
                onclick={() => (show2dOverlay = !show2dOverlay)}
              >2D 辅助</button>
            </div>
          </div>

          <div class="cube-visual-stage">
            {#if trainer.connectedDeviceName && trainer.gyroCalibration.enabled && trainer.gyroQuaternion}
              {#if trainer.poseAligned}
                <span class="pose-align-chip aligned" title="快速校准已将当前白上绿前姿态绑定为标准姿态">
                  <Check size={13} aria-hidden="true" /> 姿态已对齐
                </span>
              {:else}
                <button
                  class="pose-align-chip unaligned"
                  onclick={() => trainer.zeroGyro()}
                  title="陀螺仪没有指南针，每次连接偏航角随机。把魔方白上绿前放好，点此或按 C 一键对齐"
                >
                  <Compass size={14} aria-hidden="true" /> 姿态未对齐 · 白上绿前放好后点此或按 C
                </button>
              {/if}
            {/if}
            <Cube3D
              cube={trainer.cube}
              orientation={trainer.gyroQuaternion}
              gyroCalibration={trainer.gyroCalibration}
              stickerPalette={trainer.stickerPalette}
              interactive={!trainer.connectedDeviceName || !trainer.gyroCalibration.enabled}
              moveSerial={trainer.eventCount}
              lastMove={trainer.lastMove}
              viewPreset={trainer.viewPresetId}
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

          {#if quickCalibrationStatus}
            <p class="quick-calibration-status">{quickCalibrationStatus}</p>
          {/if}

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
      <CaseLibrary stickerPalette={trainer.stickerPalette} />
    {:else if activeSection === "history"}
      <section class="placeholder-page reconstruction-page">
        <BarChart3 size={42} />
        <span class="eyebrow">Solve Reconstruction SSOT</span>
        <h1>本次复盘</h1>
        {#if trainer.reconstruction.complete}
          <p>所有阶段、TPS、停顿和回放都来自同一条设备时间轴；UI 不再各自推断阶段。</p>
          <div class="reconstruction-summary">
            <article><span>总计</span><strong>{trainer.formatTime(trainer.reconstruction.totalDurationMs ?? 0)}</strong><small>{trainer.reconstruction.moves.length} HTM · {trainer.reconstruction.totalTps ?? "—"} TPS</small></article>
            <article><span>OLL Case</span><strong>{trainer.reconstruction.ollCase?.name ?? "—"}</strong><small>{trainer.reconstruction.ollCase?.id ?? "未识别"}</small></article>
            <article><span>PLL Case</span><strong>{trainer.reconstruction.pllCase?.name ?? "—"}</strong><small>{trainer.reconstruction.pllCase?.id ?? "未识别"}</small></article>
            <article><span>停顿</span><strong>{trainer.reconstruction.pauseCount}</strong><small>≥ 700 ms</small></article>
          </div>
          <div class="split-table">
            {#each trainer.reconstruction.splits as split}
              <article>
                <strong>{split.phase.toUpperCase()}</strong>
                <span>{split.moveCount} moves</span>
                <span>{split.durationMs === null ? "时间缺失" : trainer.formatTime(split.durationMs)}</span>
                <span>{split.tps ?? "—"} TPS</span>
              </article>
            {/each}
          </div>
          {#if trainer.reconstruction.f2lPairs.length > 0}
            <div class="split-table">
              {#each trainer.reconstruction.f2lPairs as pair, index}
                <article><strong>Pair {index + 1}</strong><span>{pair.id}</span><span>move {pair.completedAtMove ?? "—"}</span><span>{pair.durationFromPreviousMs === null ? "—" : trainer.formatTime(pair.durationFromPreviousMs)}</span></article>
              {/each}
            </div>
          {/if}
          {#each trainer.reconstruction.algorithmComparisons as comparison}
            <div class="formula-comparison">
              <strong>{comparison.phase.toUpperCase()} 公式比较</strong>
              <span>{comparison.equivalentIgnoringAufAndRotations ? "与推荐公式等价（已忽略 AUF / x y z）" : `核心多 ${comparison.extraCoreMoves} 步`}</span>
              <code>{comparison.recommended.join(" ")}</code>
            </div>
          {/each}
          <div class="move-replay-strip">
            {#each trainer.reconstruction.moves as entry}<code class:recovered={entry.source === "history"}>{entry.move}</code>{/each}
          </div>
          <div class="replay-player">
            <CubeNet cube={replayCube} />
            <label>
              <span>回放 {replayIndex}/{trainer.reconstruction.moves.length}</span>
              <input type="range" min="0" max={trainer.reconstruction.moves.length} bind:value={replayIndex} />
            </label>
            <div>
              <button class="secondary-button" disabled={replayIndex <= 0} onclick={() => (replayIndex -= 1)}><SkipBack size={17} /> 上一步</button>
              <button class="secondary-button" disabled={replayIndex >= trainer.reconstruction.moves.length} onclick={() => (replayIndex += 1)}>下一步 <SkipForward size={17} /></button>
            </div>
          </div>
          <div class="cross-suggestion">
            <button class="secondary-button" onclick={() => trainer.computeCrossSuggestion()}>计算最短 Cross</button>
            <code>{trainer.crossSuggestion === null ? "按需搜索，最多 8 HTM" : trainer.crossSuggestion.join(" ") || "Cross 在起始状态已完成"}</code>
          </div>
          <p>同面抵消后 {trainer.reconstruction.moveEfficiency.cancellationReducedHtm} HTM，检测到 {trainer.reconstruction.moveEfficiency.avoidableMoves} 个可直接抵消动作。历史补回动作以虚线标记。</p>
        {:else if !trainer.reconstruction.continuous}
          <p>本段包含 snapshot discontinuity，因此不会伪装成完整解法。重新完成一轮连续训练后才生成 CFOP 分段。</p>
        {:else}
          <p>完成一次连续的实体魔方还原后，这里会显示 Cross/F2L/OLL/PLL 分段、设备时间 TPS、停顿、Case 和逐步回放。</p>
        {/if}
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
            <strong>快速校准魔方</strong>
            <small>姿态校准、读取当前六面，以及实体已还原时写回设备，统一使用首页同一个快速校准流程。</small>
          </div>
          <button
            class="primary-button"
            disabled={!trainer.connectedDeviceName || !trainer.gyroQuaternion}
            onclick={openQuickCalibration}
          ><RefreshCcw size={17} /> 打开快速校准</button>
        </div>

        <div class="state-sync-panel signal-lab-entry">
          <div>
            <strong>魔方信号采集实验室</strong>
            <small>沿连续空中路径采集 24 个稳定姿态节点，用完整 SO(3) 边关系反推出传感器映射。</small>
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
                · {trainer.signalCalibrationProfile.staticPoses.length}/24 姿态
                · {trainer.signalCalibrationProfile.dynamicAxes.length}/24 姿态边
              </small>
            </div>
            <div class="profile-actions">
              <button class="secondary-button" onclick={reprocessSavedSignalProfile}>
                <RefreshCcw size={17} /> 用新求解器重新应用
              </button>
              <button class="secondary-button" onclick={() => void downloadSavedSignalProfile()}>
                <Download size={17} /> 重新导出 JSON
              </button>
              {#if signalReprocessStatus}<small>{signalReprocessStatus}</small>{/if}
            </div>
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

          <div class="palette-heading">
            <div>
              <strong>3D 默认视角</strong>
              <small>3D 魔方视图的初始角度；拖动后双击或按 Home 回到这里</small>
            </div>
          </div>
          <div class="view-preset-grid" aria-label="3D 默认视角">
            {#each VIEW_PRESETS as preset}
              <button
                class="view-preset"
                class:active={trainer.viewPresetId === preset.id}
                aria-pressed={trainer.viewPresetId === preset.id}
                onclick={() => trainer.setViewPreset(preset.id)}
              >
                <span class="mini-cube-scene" aria-hidden="true">
                  <span class="mini-cube" style:--p={`${preset.pitchDeg}deg`} style:--y={`${preset.yawDeg}deg`}>
                    <i class="mc-top"></i><i class="mc-front"></i><i class="mc-left"></i>
                  </span>
                </span>
                <strong>{preset.label}</strong>
                <small>{preset.hint}</small>
              </button>
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
            <article><span>Pose health</span><strong>{trainer.poseHealth.status}</strong><code>{trainer.poseHealth.message}</code></article>
            <article><span>Session anchor</span><strong>{trainer.sessionAnchor?.reason ?? "等待首帧"}</strong><code>{trainer.sessionAnchor ? new Date(trainer.sessionAnchor.establishedAt).toLocaleTimeString() : "—"}</code></article>
            <article><span>Timeline</span><strong>{trainer.timelineContinuous ? "连续" : "已截断"}</strong><code>{trainer.timelineItems.length} events</code></article>
          </div>

          {#if streamLogInfo}
            <div class="stream-log-info">
              <div class="palette-heading">
                <div>
                  <strong>实时数据流记录</strong>
                  <small>解密后的协议帧、姿态与动作全量落盘（不含设备身份），供离线分析；单个文件 {Math.round(streamLogInfo.maxFileBytes / 1024 / 1024)} MiB，滚动保留 {streamLogInfo.rotatedFiles + 1} 个（共 {Math.round(streamLogInfo.maxTotalBytes / 1024 / 1024)} MiB）</small>
                </div>
              </div>
              <code class="stream-log-path">{streamLogInfo.directory}/{streamLogInfo.activeFile}</code>
            </div>
          {/if}

          <section class="protocol-validation-panel" aria-labelledby="protocol-validation-title">
            <div class="protocol-validation-heading">
              <div>
                <span class="eyebrow">Ground-truth validation</span>
                <h3 id="protocol-validation-title">GAN V4 渐进式协议验收</h3>
              </div>
              <StatusPill tone={trainer.protocolDiagnostics.invalidFrames > 0 ? "error" : trainer.protocolDiagnostics.issues.length > 0 ? "warning" : "success"}>
                {trainer.protocolDiagnostics.invalidFrames > 0
                  ? `${trainer.protocolDiagnostics.invalidFrames} 个异常包`
                  : trainer.protocolDiagnostics.issues.length > 0
                    ? `${trainer.protocolDiagnostics.issues.length} 类警告`
                    : `${trainer.protocolDiagnostics.parsedFrames} 个包正常`}
              </StatusPill>
            </div>

            {#if trainer.protocolSelfTest.status === "idle"}
              <p>逐步验证当前六面、12 个单层方向，以及红—橙 / 白—黄 / 绿—蓝三条整颗旋转轴。每一步只采集解析字段、统计量与四元数起止检查点。</p>
              <button class="primary-button" disabled={!trainer.connectedDeviceName || trainer.connectedProtocol !== "v4"} onclick={() => void trainer.startProgressiveProtocolValidation()}>
                <ScanSearch size={17} /> 开始渐进式验收
              </button>
            {:else}
              <div class="protocol-validation-progress">
                <span>进度 {Math.min(trainer.protocolSelfTest.stepIndex + 1, GAN_V4_VALIDATION_STEPS.length)} / {GAN_V4_VALIDATION_STEPS.length}</span>
                <progress value={trainer.protocolSelfTest.stepIndex} max={GAN_V4_VALIDATION_STEPS.length}></progress>
              </div>

              {#if trainer.currentProtocolValidationStep}
                <article class="protocol-current-step">
                  <span>{trainer.currentProtocolValidationStep.kind === "baseline" ? "基准" : trainer.currentProtocolValidationStep.kind === "layer-move" ? "单层动作" : "整颗旋转"}</span>
                  <h4>{trainer.currentProtocolValidationStep.title}</h4>
                  <p>{trainer.protocolSelfTest.message}</p>
                </article>
              {:else}
                <p class="protocol-complete-message">{trainer.protocolSelfTest.message}</p>
              {/if}

              {#if trainer.currentProtocolValidationStep?.kind === "whole-cube-rotation"}
                {@const rotation = trainer.currentProtocolValidationRotation}
                {@const rotationAngle = rotation?.angleDeg ?? 0}
                <section class:anchored={trainer.protocolSelfTest.captureAnchored} class="protocol-rotation-feedback" aria-label="整颗旋转实时进度">
                  <div class="protocol-rotation-target">
                    <span>{trainer.protocolSelfTest.captureAnchored ? "当前已旋转" : "尚未开始记录"}</span>
                    <strong>{trainer.protocolSelfTest.captureAnchored ? `${rotationAngle.toFixed(1)}°` : "—"}</strong>
                    <small>/ 目标 90°</small>
                  </div>
                  <progress value={Math.min(rotationAngle, 90)} max="90"></progress>
                  <div class="protocol-rotation-guidance">
                    <strong>
                      {!trainer.protocolSelfTest.captureAnchored
                        ? "先摆好指定朝向，再点击“以当前姿态为起点”"
                        : rotationAngle < 8
                          ? "起点已锁定，可以开始旋转"
                          : rotationAngle < 75
                            ? `继续旋转，还差约 ${(90 - rotationAngle).toFixed(0)}°`
                            : rotationAngle <= 105
                              ? "已到达 90° 目标区间，请保持不动"
                              : `已超过目标约 ${(rotationAngle - 90).toFixed(0)}°`}
                    </strong>
                    <span>
                      {rotation
                        ? `协议局部主分量：${rotation.dominantAxis.toUpperCase()} · ${rotation.direction === "positive" ? "正" : "负"}（仅供诊断，不代表现实方向）`
                        : "锁定起点后，这里会显示协议局部分量；现实动作始终以指定颜色面正对你的视角为准"}
                    </span>
                  </div>
                </section>
              {/if}

              <div class="protocol-live-grid">
                <article><span>实际动作</span><strong>{trainer.protocolSelfTest.observedMoves.join(" ") || "—"}</strong></article>
                <article><span>Sequence</span><strong>{trainer.cubeSequence ?? "—"}</strong></article>
                <article><span>陀螺仪采样</span><strong>{trainer.protocolSelfTest.gyroSampleCount}</strong></article>
                <article><span>最大姿态变化</span><strong>{trainer.protocolSelfTest.maxGyroDeltaDeg.toFixed(1)}°</strong></article>
                <article>
                  <span>实时整颗旋转</span>
                  <strong>
                    {trainer.currentProtocolValidationRotation
                      ? `${trainer.currentProtocolValidationRotation.dominantAxis.toUpperCase()} · ${trainer.currentProtocolValidationRotation.direction === "positive" ? "+" : "−"} · ${trainer.currentProtocolValidationRotation.angleDeg.toFixed(1)}°`
                      : trainer.currentProtocolValidationStep?.kind === "whole-cube-rotation"
                        ? "等待设定起点"
                        : "—"}
                  </strong>
                </article>
                <article><span>包总数</span><strong>{trainer.protocolDiagnostics.totalFrames}</strong></article>
                <article><span>0xED 固件兼容包</span><strong>{trainer.protocolDiagnostics.snapshotZeroCounters}</strong></article>
                <article><span>Sequence gap</span><strong>{trainer.protocolDiagnostics.moveSequenceGaps}</strong></article>
                <article><span>Unknown / invalid</span><strong>{trainer.protocolDiagnostics.unknownFrames} / {trainer.protocolDiagnostics.invalidFrames}</strong></article>
              </div>

              {#if trainer.protocolDiagnostics.issues.length > 0}
                <div class="protocol-issue-list">
                  {#each trainer.protocolDiagnostics.issues.slice(0, 6) as issue}
                    <div class:error={issue.severity === "error"}>
                      <strong>{issue.code}</strong>
                      <span>{issue.message} · ×{issue.count}</span>
                    </div>
                  {/each}
                </div>
              {/if}

              {#if trainer.protocolSelfTest.results.length > 0}
                <div class="protocol-result-list">
                  {#each trainer.protocolSelfTest.results.slice(-6) as result}
                    <span class:passed={result.status === "passed"} class:mismatch={result.status === "mismatch"}>
                      {result.stepId} · {result.status === "passed" ? "通过" : result.status === "mismatch" ? "不一致" : "跳过"}
                    </span>
                  {/each}
                </div>
              {/if}

              <div class="protocol-validation-actions">
                {#if trainer.protocolSelfTest.status === "collecting"}
                  {#if trainer.currentProtocolValidationStep?.kind !== "whole-cube-rotation"}
                    <button class="text-button" onclick={() => trainer.skipToWholeCubeRotationValidation()}>直接跳到整颗旋转</button>
                  {/if}
                  {#if trainer.currentProtocolValidationStep?.kind === "whole-cube-rotation"}
                    <button class="secondary-button" onclick={() => trainer.anchorCurrentProtocolValidationStep()}>
                      {trainer.protocolSelfTest.captureAnchored ? "重新设定旋转起点" : "以当前姿态为起点"}
                    </button>
                  {/if}
                  <button class="text-button" onclick={() => trainer.skipProtocolValidationStep()}>跳过本步</button>
                  <button class="secondary-button" onclick={() => void completeProtocolValidationStep(true)}>标记不一致并保存 JSON</button>
                  <button class="primary-button" disabled={trainer.currentProtocolValidationStep?.kind === "whole-cube-rotation" && !trainer.protocolSelfTest.captureAnchored} onclick={() => void completeProtocolValidationStep()}><Check size={17} /> 完成本步并判断</button>
                {/if}
                <button class="secondary-button" onclick={() => void downloadProtocolValidationReport()}><Download size={17} /> 下载诊断 JSON</button>
                <button class="text-button" onclick={() => trainer.resetProgressiveProtocolValidation()}>重新开始</button>
              </div>
            {/if}
          </section>
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

  {#if quickCalibrationOpen}
    <div
      class="quick-calibration-backdrop"
      role="presentation"
      onclick={(event) => {
        if (event.target === event.currentTarget) quickCalibrationOpen = false;
      }}
    >
      <div class="quick-calibration-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-calibration-title">
        <span class="eyebrow">Pose + cube state</span>
        <h2 id="quick-calibration-title">快速校准魔方</h2>
        <p>实体魔方不需要还原。把它稳定放在桌面上：白色中心朝上、绿色中心朝向你、红色自然位于右侧。确认后会校准本次会话姿态，并从 GAN 读取当前任意乱序的完整六面。</p>
        <CalibrationGuide3D mode="static" top="white" front="green" />
        <div class="quick-calibration-readiness" class:ready={quickCalibrationReady}>
          {#if quickCalibrationReady}
            <Check size={17} /> 姿态流实时且魔方已稳定，可以校准姿态并读取当前六面
          {:else if !poseStreamFresh}
            <CircleAlert size={17} /> 姿态流已过期，请先转动唤醒魔方；仍无数据时重新连接
          {:else}
            <Activity size={17} /> 请保持魔方静止，当前帧变化 {trainer.poseHealth.lastStepDeg?.toFixed(2) ?? "—"}°
          {/if}
        </div>
        <small>默认动作只读取 GAN 的 0xED 当前状态包；只有你确定实体魔方已经完全还原时，才使用“实体已还原”向设备写入 CubeStation 的 D2 复原状态命令。设备轴映射不受影响。</small>
        <div class="quick-calibration-actions">
          <button class="secondary-button" onclick={() => (quickCalibrationOpen = false)}>取消</button>
          {#if !poseStreamFresh}
            <button class="secondary-button" onclick={() => {
              quickCalibrationOpen = false;
              openCubeConnection();
            }}><BluetoothSearching size={17} /> 打开连接面板</button>
          {/if}
          <button class="secondary-button" disabled={!quickCalibrationReady || quickCalibrationSyncing} onclick={() => void runQuickCalibration("write-solved")}>
            实体已还原 · 校准并写回设备
          </button>
          <button class="primary-button" disabled={!quickCalibrationReady || quickCalibrationSyncing} onclick={() => void runQuickCalibration("read-device")}>
            <Check size={17} /> {quickCalibrationSyncing ? "正在处理" : "校准并读取设备状态"}
          </button>
        </div>
      </div>
    </div>
  {/if}

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
  .top-telemetry { display: flex; min-width: 0; align-items: center; gap: 7px; }
  .telemetry-compact,
  .telemetry-compact.pose-latency { display: none; }
  .pose-latency { display: inline-block; width: 5ch; font-variant-numeric: tabular-nums; text-align: right; }
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
  .section-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .quick-calibration-status { margin: -4px 0 4px; color: var(--color-primary); font-size: 0.72rem; text-align: center; }
  .quick-calibration-backdrop { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 20px; background: rgb(5 8 8 / 0.74); backdrop-filter: blur(10px); }
  .quick-calibration-dialog { display: grid; width: min(560px, 100%); max-height: calc(100vh - 40px); justify-items: center; gap: 13px; overflow: auto; padding: 24px; border: 1px solid var(--color-outline); border-radius: 22px; background: var(--color-surface); box-shadow: 0 28px 90px rgb(0 0 0 / 0.5); text-align: center; }
  .quick-calibration-dialog h2 { margin: 0; }
  .quick-calibration-dialog > p { max-width: 500px; margin: 0; color: var(--color-text-muted); font-size: 0.82rem; line-height: 1.65; }
  .quick-calibration-dialog > small { color: var(--color-text-muted); font-size: 0.68rem; line-height: 1.5; }
  .quick-calibration-readiness { display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; border: 1px solid var(--color-outline); border-radius: 11px; color: var(--color-warning); background: var(--color-surface-highest); font-size: 0.74rem; }
  .quick-calibration-readiness.ready { color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 40%, transparent); }
  .quick-calibration-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 9px; }

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
  .pose-align-chip {
    position: absolute;
    z-index: 4;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 20px);
    min-height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 750;
    white-space: nowrap;
  }
  .pose-align-chip.aligned {
    border: 1px solid rgb(114 215 167 / 0.4);
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-surface-high) 86%, transparent);
  }
  .pose-align-chip.unaligned {
    border: 1px solid rgb(255 196 84 / 0.55);
    color: #b97f0a;
    background: color-mix(in srgb, rgb(255 214 130 / 0.92) 18%, var(--color-surface-high));
    cursor: pointer;
    animation: pose-chip-in 180ms ease-out;
  }
  .pose-align-chip.unaligned:hover { border-color: rgb(255 196 84 / 0.95); }
  @keyframes pose-chip-in {
    from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
    to { opacity: 1; transform: translateX(-50%); }
  }
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
  .reconstruction-page { max-width: 980px; }
  .reconstruction-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; width: 100%; }
  .reconstruction-summary article { display: grid; gap: 5px; padding: 14px; border: 1px solid var(--color-outline-soft); border-radius: 15px; background: var(--color-surface-high); }
  .reconstruction-summary span, .reconstruction-summary small { color: var(--color-text-muted); font-size: 0.68rem; }
  .reconstruction-summary strong { font-size: 1.15rem; }
  .split-table { display: grid; gap: 7px; width: 100%; }
  .split-table article { display: grid; grid-template-columns: 80px repeat(3, 1fr); gap: 12px; padding: 11px 14px; border-radius: 12px; background: var(--color-surface-high); font-size: 0.76rem; }
  .split-table span { color: var(--color-text-muted); }
  .move-replay-strip { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; padding: 13px; border-radius: 14px; background: var(--color-surface-high); }
  .move-replay-strip code { padding: 5px 7px; border-radius: 7px; color: var(--color-text); background: var(--color-surface-highest); }
  .move-replay-strip code.recovered { border-bottom: 1px dashed var(--color-warning); color: var(--color-warning); }
  .replay-player { display: grid; grid-template-columns: 180px minmax(220px, 1fr); gap: 16px; align-items: center; width: 100%; padding: 14px; border: 1px solid var(--color-outline-soft); border-radius: 16px; }
  .replay-player label { display: grid; gap: 9px; color: var(--color-text-muted); font-size: 0.74rem; }
  .replay-player input { width: 100%; accent-color: var(--color-primary); }
  .replay-player div { display: flex; gap: 8px; }
  .cross-suggestion { display: flex; align-items: center; gap: 12px; width: 100%; }
  .cross-suggestion code { color: var(--color-primary); }
  .formula-comparison { display: grid; gap: 6px; width: 100%; padding: 13px 15px; border-left: 3px solid var(--color-primary); border-radius: 10px; background: var(--color-surface-high); }
  .formula-comparison span { color: var(--color-text-muted); font-size: 0.74rem; }
  .formula-comparison code { overflow-wrap: anywhere; color: var(--color-info); }
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
  .saved-profile-panel .profile-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .saved-profile-panel .profile-actions small { max-width: 280px; color: var(--color-primary); text-align: right; }
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
  .stream-log-info { display: grid; gap: 8px; width: 100%; padding: 12px; border: 1px dashed var(--color-outline-soft); border-radius: 13px; background: var(--color-surface-high); }
  .stream-log-info .palette-heading { margin: 0; }
  .stream-log-path { overflow: hidden; color: var(--color-info); font-size: 0.7rem; text-overflow: ellipsis; white-space: nowrap; }
  .view-preset-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; width: 100%; }
  .view-preset { display: grid; justify-items: center; gap: 5px; padding: 10px 6px 9px; border: 1px solid var(--color-outline-soft); border-radius: 13px; background: var(--color-surface-high); cursor: pointer; }
  .view-preset.active { border-color: rgb(135 232 188 / 0.55); background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-high)); }
  .view-preset strong { color: var(--color-text); font-size: 0.74rem; }
  .view-preset small { color: var(--color-text-muted); font-size: 0.6rem; text-align: center; }
  .mini-cube-scene { display: grid; place-items: center; width: 48px; height: 44px; perspective: 380px; }
  .mini-cube { position: relative; width: 24px; height: 24px; transform-style: preserve-3d; transform: rotateX(calc(var(--p) * -1)) rotateY(var(--y)); }
  .mini-cube i { position: absolute; inset: 0; border: 1px solid rgb(0 0 0 / 0.4); backface-visibility: hidden; }
  .mini-cube .mc-top { background: var(--cube-white); transform: rotateX(90deg) translateZ(12px); }
  .mini-cube .mc-front { background: var(--cube-green); transform: translateZ(12px); }
  .mini-cube .mc-left { background: var(--cube-orange); filter: brightness(0.82); transform: rotateY(-90deg) translateZ(12px); }
  .protocol-validation-panel { display: grid; width: 100%; gap: 14px; padding: 16px; border: 1px solid rgb(92 185 150 / 0.3); border-radius: 18px; background: color-mix(in srgb, var(--color-primary) 5%, var(--color-surface-high)); }
  .protocol-validation-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .protocol-validation-heading h3 { margin: 3px 0 0; }
  .protocol-validation-panel > p { margin: 0; color: var(--color-text-muted); font-size: 0.76rem; line-height: 1.55; }
  .protocol-validation-progress { display: grid; grid-template-columns: auto minmax(120px, 1fr); align-items: center; gap: 12px; color: var(--color-text-muted); font-size: 0.72rem; }
  .protocol-validation-progress progress { width: 100%; height: 8px; overflow: hidden; border: 0; border-radius: 999px; accent-color: var(--color-primary); }
  .protocol-current-step { display: grid; gap: 5px; padding: 14px; border-left: 3px solid var(--color-primary); border-radius: 12px; background: var(--color-surface-highest); }
  .protocol-current-step > span { color: var(--color-primary); font-size: 0.66rem; text-transform: uppercase; }
  .protocol-current-step h4, .protocol-current-step p { margin: 0; }
  .protocol-current-step p, .protocol-complete-message { color: var(--color-text-muted); font-size: 0.76rem; line-height: 1.55; }
  .protocol-rotation-feedback { display: grid; gap: 12px; padding: 16px; border: 1px dashed var(--color-border-strong); border-radius: 14px; background: var(--color-surface-high); }
  .protocol-rotation-feedback.anchored { border-style: solid; border-color: color-mix(in srgb, var(--color-primary) 52%, var(--color-border)); }
  .protocol-rotation-target { display: flex; align-items: baseline; gap: 7px; }
  .protocol-rotation-target span { margin-right: auto; color: var(--color-text-muted); font-size: 0.72rem; }
  .protocol-rotation-target strong { color: var(--color-primary); font-size: clamp(2rem, 6vw, 3.3rem); font-variant-numeric: tabular-nums; line-height: 1; }
  .protocol-rotation-target small { color: var(--color-text-muted); font-size: 0.76rem; }
  .protocol-rotation-feedback progress { width: 100%; height: 12px; overflow: hidden; border: 0; border-radius: 999px; accent-color: var(--color-primary); }
  .protocol-rotation-guidance { display: grid; gap: 4px; }
  .protocol-rotation-guidance strong { font-size: 0.84rem; }
  .protocol-rotation-guidance span { color: var(--color-text-muted); font-size: 0.7rem; }
  .protocol-live-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .protocol-live-grid article { display: grid; min-width: 0; gap: 4px; padding: 10px; border-radius: 11px; background: var(--color-surface-high); }
  .protocol-live-grid span { color: var(--color-text-muted); font-size: 0.64rem; }
  .protocol-live-grid strong { overflow: hidden; font-size: 0.84rem; text-overflow: ellipsis; white-space: nowrap; }
  .protocol-issue-list { display: grid; gap: 6px; }
  .protocol-issue-list div { display: grid; gap: 2px; padding: 9px 11px; border-radius: 10px; color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 8%, transparent); }
  .protocol-issue-list div.error { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 8%, transparent); }
  .protocol-issue-list strong { font-size: 0.7rem; }
  .protocol-issue-list span { font-size: 0.66rem; line-height: 1.4; }
  .protocol-result-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .protocol-result-list span { padding: 5px 8px; border-radius: 999px; color: var(--color-text-muted); background: var(--color-surface-highest); font-size: 0.64rem; }
  .protocol-result-list span.passed { color: var(--color-success); }
  .protocol-result-list span.mismatch { color: var(--color-error); }
  .protocol-validation-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }

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
    .top-status { gap: 5px; }
    .top-connection :global(.status-pill) { max-width: min(34vw, 140px); }
    .top-telemetry { gap: 4px; }
    .top-telemetry :global(.status-pill) { padding-inline: 7px; }
    .telemetry-full { display: none; }
    .telemetry-compact { display: inline; }
    .telemetry-compact.pose-latency { display: inline-block; }
    .navigation-rail { display: none; }
    .content { padding: 10px 10px 22px; }
    .calibration-heading { align-items: start; flex-direction: column; }
    .state-sync-panel { align-items: stretch; flex-direction: column; }
    .saved-profile-panel { align-items: stretch; flex-direction: column; }
    .saved-profile-panel .profile-actions { align-items: stretch; flex-direction: column; }
    .saved-profile-panel .profile-actions small { max-width: none; text-align: left; }
    .face-color-grid { grid-template-columns: repeat(3, 1fr); }
    .palette-heading { align-items: start; flex-direction: column; }
    .sticker-palette-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gyro-offsets { grid-template-columns: 1fr; }
    .protocol-debug { grid-template-columns: 1fr; }
    .protocol-validation-heading { align-items: flex-start; flex-direction: column; }
    .protocol-live-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .protocol-validation-actions { align-items: stretch; flex-direction: column; }
    .training-layout { gap: 10px; }
    .workspace-card { border-radius: 20px; }
    .cube-workspace { padding: 14px 10px; }
    .cube-net-overlay { right: 2px; bottom: 6px; transform: scale(0.82); transform-origin: right bottom; }
    .section-heading { padding-inline: 5px; }
    .section-heading { align-items: start; }
    .section-actions { justify-content: stretch; }
    .section-actions .secondary-button { flex: 1 1 auto; }
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
    .reconstruction-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .split-table article { grid-template-columns: 64px 1fr; }
    .replay-player { grid-template-columns: 1fr; }
    .cross-suggestion { align-items: stretch; flex-direction: column; }
    .quick-calibration-backdrop { align-items: end; padding: 0; }
    .quick-calibration-dialog { max-height: 94vh; padding: 20px 14px 26px; border-radius: 22px 22px 0 0; }
  }
</style>
