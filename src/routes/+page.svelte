<script lang="ts">
  import { onMount } from "svelte";
  import {
    Activity,
    BarChart3,
    Bluetooth,
    BluetoothSearching,
    BookOpenCheck,
    Check,
    ChevronRight,
    CircleAlert,
    History,
    LayoutDashboard,
    Pause,
    Play,
    Radio,
    RefreshCcw,
    RotateCcw,
    Settings,
    ShieldAlert,
    SkipBack,
    SkipForward,
    Smartphone,
    Sparkles,
    TimerReset,
    X,
  } from "lucide-svelte";
  import Cube3D from "$lib/components/Cube3D.svelte";
  import CubeNet from "$lib/components/CubeNet.svelte";
  import StatusPill from "$lib/components/StatusPill.svelte";
  import TimerDisplay from "$lib/components/TimerDisplay.svelte";
  import { CONNECTION_LABELS, PHASE_LABELS, trainer } from "$lib/stores/trainer.svelte";
  import { FACES, type StickerColor } from "$lib/cube/cube";

  type Section = "train" | "cases" | "history" | "settings";
  const colorOptions: Array<{ value: StickerColor; label: string }> = [
    { value: "white", label: "白" }, { value: "yellow", label: "黄" },
    { value: "red", label: "红" }, { value: "orange", label: "橙" },
    { value: "green", label: "绿" }, { value: "blue", label: "蓝" },
  ];

  let activeSection = $state<Section>("train");
  let cubeView = $state<"2d" | "3d">("2d");
  let deviceDialogOpen = $state(false);

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

  function primaryAction(): void {
    trainer.prepareScramble();
  }

  async function scanForDevices(): Promise<void> {
    deviceDialogOpen = true;
    await trainer.scanRealDevices();
  }

  async function connectSelectedDevice(device: (typeof trainer.devices)[number]): Promise<void> {
    await trainer.connectRealDevice(device);
    if (trainer.connection === "ready" || trainer.connection === "degraded") {
      deviceDialogOpen = false;
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

<div class="app-shell">
  <header class="top-app-bar">
    <div class="brand">
      <span class="brand-mark"><Sparkles size={19} strokeWidth={2.4} /></span>
      <div>
        <strong>CFOP Trainer</strong>
        <span>Bluetooth cube lab</span>
      </div>
    </div>

    <div class="top-status">
      <StatusPill tone={connectionTone}>
        {#if trainer.connection === "scanning"}
          <BluetoothSearching size={15} />
        {:else}
          <Bluetooth size={15} />
        {/if}
        {CONNECTION_LABELS[trainer.connection]}
      </StatusPill>
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
      <section class="connection-banner tone-{connectionTone}">
        <div class="banner-icon">
          {#if trainer.connection === "degraded"}
            <ShieldAlert size={21} />
          {:else if connectionTone === "error"}
            <CircleAlert size={21} />
          {:else}
            <Radio size={21} />
          {/if}
        </div>
        <div>
          <strong>{CONNECTION_LABELS[trainer.connection]}</strong>
          <p>{trainer.connectionMessage}</p>
        </div>
        <div class="banner-actions">
          <button
            class="text-button"
            disabled={deviceDialogBusy}
            onclick={() => void scanForDevices()}
          >
            <BluetoothSearching size={17} /> 扫描真机
          </button>
        </div>
      </section>

      <div class="training-layout">
        <section class="workspace-card cube-workspace">
          <div class="section-heading">
            <div>
              <span class="eyebrow">实时魔方</span>
              <h1>{PHASE_LABELS[trainer.phase]} 阶段</h1>
            </div>
            <div class="segmented-control" aria-label="魔方视图">
              <button
                class:selected={cubeView === "2d"}
                aria-pressed={cubeView === "2d"}
                onclick={() => (cubeView = "2d")}
              >2D</button>
              <button
                class:selected={cubeView === "3d"}
                aria-pressed={cubeView === "3d"}
                onclick={() => (cubeView = "3d")}
              >3D</button>
            </div>
          </div>

          {#if cubeView === "2d"}
            <CubeNet cube={trainer.cube} />
          {:else}
            <Cube3D
              cube={trainer.cube}
              orientation={trainer.gyroQuaternion}
              gyroCalibration={trainer.gyroCalibration}
            />
          {/if}

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
              <StatusPill tone="info">{trainer.connectedDeviceName ? "GAN V4 真机" : "演示播放器"}</StatusPill>
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
          <select>
            <option>白色</option>
            <option>黄色</option>
          </select>
        </label>
        <div class="platform-note"><Smartphone size={18} /> 手机训练时保持前台和屏幕常亮。</div>

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
              当前姿态设为正面
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
    <div class="device-dialog-backdrop" role="presentation">
      <div
        class="device-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-dialog-title"
      >
        <header class="device-dialog-header">
          <div>
            <span class="eyebrow">Bluetooth LE</span>
            <h2 id="device-dialog-title">选择蓝牙魔方</h2>
          </div>
          <button
            class="dialog-close-button"
            aria-label="关闭设备选择"
            disabled={deviceDialogBusy}
            onclick={closeDeviceDialog}
          >
            <X size={19} />
          </button>
        </header>

        <div class="device-dialog-status tone-{connectionTone}">
          {#if trainer.connection === "scanning"}
            <BluetoothSearching class="spinning" size={21} />
          {:else if connectionTone === "error"}
            <CircleAlert size={21} />
          {:else}
            <Radio size={21} />
          {/if}
          <div>
            <strong>{CONNECTION_LABELS[trainer.connection]}</strong>
            <p>{trainer.connectionMessage}</p>
          </div>
        </div>

        {#if trainer.connection === "scanning"}
          <div class="device-dialog-scanning">
            <span class="scan-radar"><BluetoothSearching size={28} /></span>
            <strong>正在查找附近的 GAN 魔方</strong>
            <p>保持魔方唤醒并靠近设备，扫描约需 10 秒。</p>
          </div>
        {:else if trainer.devices.length > 0}
          <div class="device-dialog-list" aria-label="发现的设备">
            {#each trainer.devices as device}
              <button
                disabled={deviceDialogBusy}
                onclick={() => void connectSelectedDevice(device)}
              >
                <span class="device-dialog-icon"><Bluetooth size={19} /></span>
                <span class="device-dialog-copy">
                  <strong>{device.name}</strong>
                  <small>GAN V4 · RSSI {device.rssi ?? "—"}</small>
                </span>
                <StatusPill tone={trainer.connectedDeviceName === device.name ? "success" : "info"}>
                  {trainer.connectedDeviceName === device.name
                    ? `已连接${trainer.battery === null ? "" : ` · ${trainer.battery}%`}`
                    : deviceDialogBusy
                      ? "连接中"
                      : "连接"}
                </StatusPill>
              </button>
            {/each}
          </div>
        {:else}
          <div class="device-dialog-empty">
            <BluetoothSearching size={30} />
            <strong>暂未发现 GAN 魔方</strong>
            <p>转动魔方使其重新广播，然后再次扫描。</p>
          </div>
        {/if}

        <footer class="device-dialog-actions">
          <button class="secondary-button" disabled={deviceDialogBusy} onclick={closeDeviceDialog}>
            取消
          </button>
          <button class="primary-button" disabled={deviceDialogBusy} onclick={() => void scanForDevices()}>
            <RefreshCcw size={17} /> 重新扫描
          </button>
        </footer>
      </div>
    </div>
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
  .banner-actions,
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

  .connection-banner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 13px;
    min-height: 66px;
    margin-bottom: 18px;
    padding: 11px 14px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 18px;
    background: var(--color-surface);
  }
  .connection-banner.tone-warning { border-color: rgb(241 201 111 / 0.42); }
  .connection-banner.tone-error { border-color: rgb(255 180 171 / 0.38); }
  .banner-icon {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 12px;
    color: var(--color-primary);
    background: rgb(135 232 188 / 0.09);
  }
  .tone-warning .banner-icon { color: var(--color-warning); background: rgb(241 201 111 / 0.09); }
  .tone-error .banner-icon { color: var(--color-error); background: rgb(255 180 171 / 0.09); }
  .connection-banner strong { font-size: 0.86rem; }
  .connection-banner p { margin: 3px 0 0; color: var(--color-text-muted); font-size: 0.77rem; line-height: 1.4; }
  .banner-actions { gap: 6px; }

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
  .segmented-control {
    display: flex;
    padding: 3px;
    border-radius: 11px;
    background: var(--color-surface-high);
  }
  .segmented-control button {
    min-width: 46px;
    min-height: 33px;
    border-radius: 8px;
    color: var(--color-text-muted);
    background: transparent;
  }
  .segmented-control button.selected { color: var(--color-text); background: var(--color-surface-highest); }
  .segmented-control button:disabled { opacity: 0.38; }

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

  .device-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(4 10 8 / 0.66);
    backdrop-filter: blur(12px);
  }
  .device-dialog {
    display: grid;
    gap: 16px;
    width: min(540px, 100%);
    max-height: min(720px, calc(100vh - 48px));
    overflow: auto;
    padding: 22px;
    border: 1px solid var(--color-outline);
    border-radius: 24px;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 32px 100px rgb(0 0 0 / 0.42);
  }
  .device-dialog-header,
  .device-dialog-status,
  .device-dialog-list > button,
  .device-dialog-actions {
    display: flex;
    align-items: center;
  }
  .device-dialog-header { justify-content: space-between; gap: 16px; }
  .device-dialog-header h2 { margin: 4px 0 0; font-size: 1.35rem; letter-spacing: -0.035em; }
  .dialog-close-button {
    display: grid;
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 50%;
    color: var(--color-text-muted);
    background: var(--color-surface-high);
    cursor: pointer;
  }
  .dialog-close-button:hover { color: var(--color-text); background: var(--color-surface-highest); }
  .dialog-close-button:disabled { cursor: not-allowed; opacity: 0.42; }
  .device-dialog-status {
    gap: 11px;
    min-height: 66px;
    padding: 12px 14px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 16px;
    background: var(--color-surface-high);
  }
  .device-dialog-status > :global(svg) { flex: 0 0 auto; color: var(--color-primary); }
  .device-dialog-status.tone-error > :global(svg) { color: var(--color-error); }
  .device-dialog-status.tone-warning > :global(svg) { color: var(--color-warning); }
  .device-dialog-status strong { font-size: 0.84rem; }
  .device-dialog-status p { margin: 3px 0 0; color: var(--color-text-muted); font-size: 0.74rem; line-height: 1.45; }
  .device-dialog-scanning,
  .device-dialog-empty {
    display: grid;
    min-height: 210px;
    place-items: center;
    align-content: center;
    gap: 8px;
    padding: 24px;
    color: var(--color-text-muted);
    text-align: center;
  }
  .device-dialog-scanning strong,
  .device-dialog-empty strong { color: var(--color-text); }
  .device-dialog-scanning p,
  .device-dialog-empty p { max-width: 330px; margin: 0; font-size: 0.76rem; line-height: 1.5; }
  .scan-radar,
  .device-dialog-empty > :global(svg) {
    display: grid;
    width: 58px;
    height: 58px;
    place-items: center;
    border-radius: 50%;
    color: var(--color-primary);
    background: rgb(135 232 188 / 0.1);
  }
  .scan-radar { animation: scan-pulse 1.4s ease-in-out infinite; }
  :global(.spinning) { animation: spin 1.2s linear infinite; }
  .device-dialog-list { display: grid; gap: 9px; }
  .device-dialog-list > button {
    gap: 12px;
    width: 100%;
    min-height: 70px;
    padding: 11px 13px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 16px;
    color: var(--color-text);
    background: var(--color-surface-high);
    text-align: left;
    cursor: pointer;
  }
  .device-dialog-list > button:hover { border-color: var(--color-primary); background: var(--color-surface-highest); }
  .device-dialog-list > button:disabled { cursor: wait; opacity: 0.72; }
  .device-dialog-icon {
    display: grid;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 13px;
    color: var(--color-primary);
    background: rgb(135 232 188 / 0.09);
  }
  .device-dialog-copy { display: grid; min-width: 0; flex: 1; gap: 3px; }
  .device-dialog-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .device-dialog-copy small { color: var(--color-text-muted); font-size: 0.7rem; }
  .device-dialog-actions { justify-content: flex-end; gap: 9px; padding-top: 2px; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes scan-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgb(135 232 188 / 0.18); transform: scale(0.96); }
    50% { box-shadow: 0 0 0 14px rgb(135 232 188 / 0); transform: scale(1); }
  }

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
    .connection-banner { grid-template-columns: auto minmax(0, 1fr); }
    .banner-actions { grid-column: 2; }
    .insight-column { grid-template-columns: 1fr; }
    .cube-workspace { min-height: auto; }
  }

  @media (max-width: 599px) {
    .app-shell { display: block; padding-bottom: calc(76px + env(safe-area-inset-bottom)); }
    .top-app-bar { height: 58px; padding-top: env(safe-area-inset-top); }
    .brand span:last-child,
    .top-status > :global(.status-pill) { display: none; }
    .navigation-rail { display: none; }
    .content { padding: 10px 10px 22px; }
    .connection-banner {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 9px;
      margin-bottom: 10px;
      border-radius: 17px;
    }
    .connection-banner p { font-size: 0.7rem; }
    .banner-actions { grid-column: 1 / -1; justify-content: stretch; }
    .banner-actions .text-button { flex: 1; min-height: 42px; }
    .device-dialog-backdrop { align-items: end; padding: 0; }
    .device-dialog {
      width: 100%;
      max-height: min(82vh, 720px);
      padding: 20px 16px calc(18px + env(safe-area-inset-bottom));
      border-radius: 24px 24px 0 0;
    }
    .device-dialog-actions > button { flex: 1; }
    .calibration-heading { align-items: start; flex-direction: column; }
    .face-color-grid { grid-template-columns: repeat(3, 1fr); }
    .gyro-offsets { grid-template-columns: 1fr; }
    .protocol-debug { grid-template-columns: 1fr; }
    .training-layout { gap: 10px; }
    .workspace-card { border-radius: 20px; }
    .cube-workspace { padding: 14px 10px; }
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
