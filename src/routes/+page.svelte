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
    Play,
    Radio,
    RefreshCcw,
    RotateCcw,
    Settings,
    ShieldAlert,
    SkipForward,
    Smartphone,
    Sparkles,
    TimerReset,
  } from "lucide-svelte";
  import CubeNet from "$lib/components/CubeNet.svelte";
  import StatusPill from "$lib/components/StatusPill.svelte";
  import TimerDisplay from "$lib/components/TimerDisplay.svelte";
  import { CONNECTION_LABELS, PHASE_LABELS, trainer } from "$lib/stores/trainer.svelte";

  type Section = "train" | "cases" | "history" | "settings";

  let activeSection = $state<Section>("train");

  const connectionTone = $derived(
    trainer.connection === "ready"
      ? "success"
      : trainer.connection === "degraded"
        ? "warning"
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

  const primaryLabel = $derived(
    trainer.connection !== "ready" && trainer.connection !== "degraded"
      ? "连接演示设备"
      : trainer.sessionState === "idle" || trainer.sessionState === "complete"
        ? "准备演示打乱"
        : trainer.sessionState === "scrambling"
          ? `执行 ${trainer.currentScrambleMove ?? "下一步"}`
          : trainer.sessionState === "ready" || trainer.sessionState === "running"
            ? `还原 ${trainer.currentSolveMove ?? "下一步"}`
            : "重新同步",
  );

  function primaryAction(): void {
    if (trainer.connection !== "ready" && trainer.connection !== "degraded") {
      void trainer.connectDemo();
      return;
    }

    if (trainer.sessionState === "idle" || trainer.sessionState === "complete") {
      trainer.prepareDemoScramble();
    } else if (trainer.sessionState === "scrambling") {
      trainer.applyNextScrambleMove();
    } else if (["ready", "running"].includes(trainer.sessionState)) {
      trainer.applyNextSolveMove();
    } else if (trainer.sessionState === "invalid") {
      trainer.resync();
    }
  }

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

      if (event.code === "Space" && activeSection === "train") {
        event.preventDefault();
        primaryAction();
      }

      if (event.key.toLowerCase() === "r") trainer.reset();
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
          <button class="text-button" onclick={() => void trainer.scanRealDevices()}>
            <BluetoothSearching size={17} /> 扫描真机
          </button>
          {#if trainer.connection !== "ready"}
            <button class="text-button" onclick={() => void trainer.connectDemo()}>
              <Play size={17} /> 演示连接
            </button>
          {/if}
        </div>
      </section>

      {#if trainer.devices.length > 0}
        <section class="device-strip" aria-label="发现的设备">
          {#each trainer.devices as device}
            <button onclick={() => void trainer.connectRealDevice(device)}>
              <Bluetooth size={17} />
              <span><strong>{device.name}</strong><small>GAN V4 · RSSI {device.rssi ?? "—"}</small></span>
              <StatusPill tone={trainer.connectedDeviceName === device.name ? "success" : "info"}>
                {trainer.connectedDeviceName === device.name ? `已连接${trainer.battery === null ? "" : ` · ${trainer.battery}%`}` : "连接"}
              </StatusPill>
            </button>
          {/each}
        </section>
      {/if}

      <div class="training-layout">
        <section class="workspace-card cube-workspace">
          <div class="section-heading">
            <div>
              <span class="eyebrow">实时魔方</span>
              <h1>{PHASE_LABELS[trainer.phase]} 阶段</h1>
            </div>
            <div class="segmented-control" aria-label="魔方视图">
              <button class="selected">2D</button>
              <button disabled title="3D 将在移动 WebGL 技术验证后启用">3D</button>
            </div>
          </div>

          <CubeNet cube={trainer.cube} />

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
              {#if trainer.sessionState === "scrambling" || trainer.sessionState === "running"}
                <SkipForward size={19} />
              {:else if trainer.sessionState === "invalid"}
                <RefreshCcw size={19} />
              {:else}
                <Play size={19} />
              {/if}
              {primaryLabel}
            </button>
            <button
              class="secondary-button"
              disabled={!["scrambling", "ready", "running"].includes(trainer.sessionState)}
              onclick={() => trainer.simulateDesync()}
            >
              <ShieldAlert size={18} /> 模拟丢步
            </button>
          </div>
        </section>

        <aside class="insight-column">
          <section class="workspace-card guide-card">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow">动作引导</span>
                <h2>{trainer.sessionState === "scrambling" ? "打乱序列" : "还原路径"}</h2>
              </div>
              <StatusPill tone="info">{trainer.connectedDeviceName ? "GAN V4 真机" : "演示 fixture"}</StatusPill>
            </div>

            {#if trainer.scramble.length === 0}
              <div class="empty-guide">
                <TimerReset size={32} />
                <p>连接设备后准备一次演示打乱。</p>
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
                <strong>{trainer.sessionState === "scrambling" ? trainer.currentScrambleMove ?? "完成" : trainer.currentSolveMove ?? "完成"}</strong>
              </div>
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
    border-bottom: 1px solid var(--color-outline-soft);
    background: rgb(17 20 21 / 0.88);
    backdrop-filter: blur(18px);
  }

  .brand,
  .top-status,
  .banner-actions,
  .primary-actions,
  .timer-meta,
  .device-strip > button {
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
  .brand strong { font-size: 0.95rem; letter-spacing: -0.02em; }
  .brand span:last-child { color: var(--color-text-muted); font-size: 0.68rem; }
  .top-status { gap: 9px; }

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
  }
  .icon-button:hover { background: var(--color-surface-high); color: var(--color-text); }

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
  .primary-button { color: var(--color-on-primary); background: var(--color-primary); }
  .primary-button:hover { background: var(--color-primary-strong); }
  .secondary-button { color: var(--color-text); background: var(--color-surface-highest); }
  .secondary-button:disabled { cursor: not-allowed; opacity: 0.42; }

  .device-strip {
    display: grid;
    gap: 8px;
    margin-bottom: 18px;
  }
  .device-strip > button {
    gap: 10px;
    width: 100%;
    padding: 10px 13px;
    border: 1px solid var(--color-outline-soft);
    border-radius: 14px;
    color: inherit;
    background: var(--color-surface);
    text-align: left;
    cursor: pointer;
  }
  .device-strip > button:hover { background: var(--color-surface-high); }
  .device-strip span:nth-child(2) { display: grid; flex: 1; }
  .device-strip small { color: var(--color-text-muted); font-size: 0.68rem; }

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
