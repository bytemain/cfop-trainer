<script lang="ts">
  import {
    Check,
    ChevronLeft,
    ClipboardCopy,
    Download,
    Radio,
    Rotate3D,
    ShieldCheck,
    X,
  } from "lucide-svelte";
  import Cube3D from "$lib/components/Cube3D.svelte";
  import CalibrationGuide3D from "$lib/components/CalibrationGuide3D.svelte";
  import type { CubeState } from "$lib/cube/cube";
  import type { GyroCalibration } from "$lib/cube/orientation";
  import type {
    CubeQuaternion,
    CubeSignalFrameEvent,
    GanProtocolVersion,
  } from "$lib/protocols/gan/types";
  import {
    createSignalCalibrationProfile,
    quaternionAngularDistanceDeg,
    serializeSignalCalibrationProfile,
    summarizeFrameFieldEvidence,
    summarizeDynamicAxis,
    summarizeMoveValidation,
    summarizeStaticPose,
    type CubeColor,
    type DynamicAxisCapture,
    type SignalCalibrationProfile,
    type StaticPoseCapture,
    type TimedQuaternionSample,
    type TimedVelocitySample,
    type InMemorySignalFrame,
  } from "$lib/calibration/signalProfile";

  let {
    deviceModel,
    protocol,
    cube,
    orientation,
    velocity,
    orientationSerial,
    moveSerial,
    lastMove,
    signalFrame,
    signalFrameSerial,
    gyroCalibration,
    onclose,
    onsave,
    standalone = false,
  }: {
    deviceModel: string;
    protocol: GanProtocolVersion;
    cube: CubeState;
    orientation: CubeQuaternion | null;
    velocity: { x: number; y: number; z: number } | null;
    orientationSerial: number;
    moveSerial: number;
    lastMove: string | null;
    signalFrame: CubeSignalFrameEvent | null;
    signalFrameSerial: number;
    gyroCalibration: GyroCalibration;
    onclose: () => void;
    onsave: (profile: SignalCalibrationProfile) => void;
    standalone?: boolean;
  } = $props();

  type Stage = "static" | "dynamic" | "moves" | "render" | "complete";

  const staticSteps: Array<{ top: CubeColor; front: CubeColor; title: string }> = [
    { top: "white", front: "green", title: "白色朝上 · 绿色朝前" },
    { top: "yellow", front: "blue", title: "黄色朝上 · 蓝色朝前" },
    { top: "red", front: "white", title: "红色朝上 · 白色朝前" },
    { top: "orange", front: "white", title: "橙色朝上 · 白色朝前" },
    { top: "green", front: "white", title: "绿色朝上 · 白色朝前" },
    { top: "blue", front: "white", title: "蓝色朝上 · 白色朝前" },
  ];
  const dynamicSteps: Array<{
    physicalAxis: DynamicAxisCapture["physicalAxis"];
    positiveFace: CubeColor;
    title: string;
  }> = [
    { physicalAxis: "red-orange", positiveFace: "red", title: "绕红—橙轴转动" },
    { physicalAxis: "blue-green", positiveFace: "blue", title: "绕蓝—绿轴转动" },
    { physicalAxis: "white-yellow", positiveFace: "white", title: "绕白—黄轴转动" },
  ];
  const expectedMoves = ["R", "U", "R'", "U'"];

  let stage = $state<Stage>("static");
  let staticIndex = $state(0);
  let dynamicIndex = $state(0);
  let staticCaptures = $state<StaticPoseCapture[]>([]);
  let dynamicCaptures = $state<DynamicAxisCapture[]>([]);
  let dynamicRecording = $state(false);
  let moveRecording = $state(false);
  let observedMoves = $state<string[]>([]);
  let renderConfirmed = $state(false);
  let message = $state("保持魔方静止约 1 秒，再确认当前姿态。");
  let recentQuaternionCount = $state(0);
  let dynamicSampleCount = $state(0);
  let detectedRotationDeg = $state(0);
  let lastOrientationSerial = -1;
  let lastMoveSerial = -1;
  let lastSignalFrameSerial = -1;
  let recentQuaternions: TimedQuaternionSample[] = [];
  let dynamicVelocities: TimedVelocitySample[] = [];
  let dynamicQuaternions: TimedQuaternionSample[] = [];
  let recentSignalFrames: InMemorySignalFrame[] = [];
  let staticSignalGroups: InMemorySignalFrame[][] = [];
  let dynamicSignalGroups: Partial<Record<DynamicAxisCapture["physicalAxis"], InMemorySignalFrame[]>> = {};
  let dynamicSignalFrames: InMemorySignalFrame[] = [];
  let moveSignalFrames: InMemorySignalFrame[] = [];

  const progress = $derived(
    stage === "static"
      ? staticIndex
      : stage === "dynamic"
        ? 6 + dynamicIndex
        : stage === "moves"
          ? 9
          : stage === "render"
            ? 10
            : 11,
  );
  const currentStatic = $derived(staticSteps[staticIndex]);
  const currentDynamic = $derived(dynamicSteps[dynamicIndex]);
  const moveValidation = $derived(summarizeMoveValidation(expectedMoves, observedMoves));

  $effect(() => {
    const serial = orientationSerial;
    if (serial === lastOrientationSerial || !orientation) return;
    lastOrientationSerial = serial;
    const now = Date.now();
    recentQuaternions.push({ at: now, quaternion: { ...orientation } });
    recentQuaternions = recentQuaternions.filter((sample) => now - sample.at <= 1_400);
    recentQuaternionCount = recentQuaternions.length;
    if (dynamicRecording) {
      dynamicQuaternions.push({ at: now, quaternion: { ...orientation } });
      if (velocity) dynamicVelocities.push({ at: now, velocity: { ...velocity } });
      dynamicSampleCount = dynamicQuaternions.length;
      const start = dynamicQuaternions[0]?.quaternion;
      if (start) {
        detectedRotationDeg = Math.max(
          detectedRotationDeg,
          quaternionAngularDistanceDeg(start, orientation),
        );
      }
    }
  });

  $effect(() => {
    const serial = signalFrameSerial;
    if (serial === lastSignalFrameSerial || !signalFrame) return;
    lastSignalFrameSerial = serial;
    const frame: InMemorySignalFrame = {
      at: signalFrame.receivedAt,
      layer: signalFrame.layer,
      packetType: signalFrame.packetType,
      bytes: signalFrame.bytes.slice(),
    };
    recentSignalFrames.push(frame);
    recentSignalFrames = recentSignalFrames.filter((sample) => Date.now() - sample.at <= 1_400);
    if (dynamicRecording) dynamicSignalFrames.push(frame);
    if (moveRecording) moveSignalFrames.push(frame);
  });

  $effect(() => {
    const serial = moveSerial;
    if (serial === lastMoveSerial) return;
    lastMoveSerial = serial;
    if (moveRecording && lastMove) observedMoves = [...observedMoves, lastMove];
  });

  function confirmStaticPose(): void {
    if (!currentStatic) return;
    try {
      const capture = summarizeStaticPose(
        currentStatic.top,
        currentStatic.front,
        recentQuaternions.filter((sample) => Date.now() - sample.at <= 1_200),
      );
      staticCaptures = [...staticCaptures, capture];
      staticSignalGroups.push(
        recentSignalFrames
          .filter((frame) => Date.now() - frame.at <= 1_200)
          .map((frame) => ({ ...frame, bytes: frame.bytes.slice() })),
      );
      message = `已记录 ${capture.sampleCount} 个稳定样本，最大偏差 ${capture.maxAngularDeviationDeg}°。`;
      if (staticIndex + 1 >= staticSteps.length) {
        stage = "dynamic";
        message = "接下来识别物理旋转轴。每一步先开始记录，再按提示转动整颗魔方。";
      } else {
        staticIndex += 1;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }

  function startDynamicCapture(): void {
    dynamicVelocities = [];
    dynamicQuaternions = [];
    dynamicSignalFrames = [];
    dynamicSampleCount = 0;
    detectedRotationDeg = 0;
    dynamicRecording = true;
    message = "正在记录：朝正面看目标颜色，将整颗魔方顺时针转约 90°，然后点击确认。";
  }

  function confirmDynamicCapture(): void {
    if (!currentDynamic) return;
    try {
      const capture = summarizeDynamicAxis(
        currentDynamic.physicalAxis,
        currentDynamic.positiveFace,
        dynamicVelocities,
        dynamicQuaternions,
      );
      dynamicRecording = false;
      dynamicCaptures = [...dynamicCaptures, capture];
      dynamicSignalGroups[currentDynamic.physicalAxis] = dynamicSignalFrames.map((frame) => ({
        ...frame,
        bytes: frame.bytes.slice(),
      }));
      message = `通过${capture.signalSource === "angular-velocity" ? "角速度" : "四元数差分"}识别为协议 ${capture.protocolAxis.toUpperCase()} 轴，方向 ${capture.sign > 0 ? "+" : "−"}，主导度 ${Math.round(capture.dominance * 100)}%。`;
      if (dynamicIndex + 1 >= dynamicSteps.length) {
        stage = "moves";
        message = "现在验证面编号和顺逆时针。开始记录后执行给定公式。";
      } else {
        dynamicIndex += 1;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }

  function startMoveCapture(): void {
    observedMoves = [];
    moveSignalFrames = [];
    moveRecording = true;
    message = "正在记录动作，请完整执行 R U R' U'，随后点击验证。";
  }

  function confirmMoves(): void {
    moveRecording = false;
    if (!moveValidation.matched) {
      message = `收到 ${observedMoves.join(" ") || "空序列"}，与目标公式不一致。可重新记录；保留差异也能帮助推断映射。`;
      return;
    }
    stage = "render";
    message = "动作方向一致。最后请对照实体魔方，检查六面颜色、层转动和整体姿态。";
  }

  function continueWithMoveMismatch(): void {
    moveRecording = false;
    stage = "render";
    message = "已保留动作差异作为协议映射证据。请继续确认完整渲染。";
  }

  function buildProfile(confirmed: boolean): SignalCalibrationProfile {
    return createSignalCalibrationProfile({
      deviceModel,
      protocol,
      staticPoses: staticCaptures,
      dynamicAxes: dynamicCaptures,
      moveValidation,
      renderValidation: { confirmed },
      frameFieldEvidence: summarizeFrameFieldEvidence({
        staticPoseGroups: staticSignalGroups,
        dynamicGroups: dynamicSignalGroups,
        moveFrames: moveSignalFrames,
      }),
    });
  }

  function confirmRender(confirmed: boolean): void {
    renderConfirmed = confirmed;
    const profile = buildProfile(confirmed);
    onsave(profile);
    stage = "complete";
    message = confirmed
      ? "采集完成，标定档案已保存。"
      : "采集完成，并已标记渲染仍有映射错误。";
  }

  function downloadProfile(): void {
    const profile = buildProfile(renderConfirmed);
    const blob = new Blob([serializeSignalCalibrationProfile(profile)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cube-signal-profile-${protocol}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    message = "标定 JSON 已下载。把这个文件直接拖进与 Codex 的对话即可。";
  }

  async function copyProfile(): Promise<void> {
    try {
      await navigator.clipboard.writeText(serializeSignalCalibrationProfile(buildProfile(renderConfirmed)));
      message = "标定 JSON 已复制。回到 Codex 对话直接粘贴即可。";
    } catch (error) {
      message = `复制失败：${error instanceof Error ? error.message : String(error)}。请使用文件导出。`;
    }
  }

  function goBack(): void {
    if (stage === "dynamic") {
      dynamicRecording = false;
      if (dynamicIndex === 0) {
        stage = "static";
        staticIndex = 5;
        staticCaptures = staticCaptures.slice(0, -1);
        staticSignalGroups = staticSignalGroups.slice(0, -1);
      } else {
        dynamicIndex -= 1;
        const removed = dynamicCaptures.at(-1);
        dynamicCaptures = dynamicCaptures.slice(0, -1);
        if (removed) delete dynamicSignalGroups[removed.physicalAxis];
      }
    } else if (stage === "moves") {
      stage = "dynamic";
      dynamicIndex = 2;
      const removed = dynamicCaptures.at(-1);
      dynamicCaptures = dynamicCaptures.slice(0, -1);
      if (removed) delete dynamicSignalGroups[removed.physicalAxis];
    } else if (stage === "render") {
      stage = "moves";
    }
  }
</script>

<div class="lab-backdrop" class:standalone role="presentation">
  <div class="signal-lab" role="dialog" aria-modal="true" aria-labelledby="signal-lab-title">
    <header>
      <div>
        <span class="eyebrow">Signal calibration lab</span>
        <h2 id="signal-lab-title">魔方信号采集</h2>
        <p>{deviceModel} · {protocol.toUpperCase()} · 步骤 {Math.min(progress + 1, 11)}/11</p>
      </div>
      <button class="close" aria-label="关闭信号采集" onclick={onclose}><X size={20} /></button>
    </header>

    <div class="progress"><span style={`width:${(progress / 11) * 100}%`}></span></div>

    <main>
      {#if stage === "static" && currentStatic}
        <div class="instruction-icon"><Radio size={34} /></div>
        <span class="stage-label">静态姿态 {staticIndex + 1}/6</span>
        <h3>{currentStatic.title}</h3>
        <p class="instruction">将魔方中心色严格按提示摆放，平放或稳定握持。必须同时对齐“朝上”和“朝前”，保持至少 1 秒。</p>
        <CalibrationGuide3D mode="static" top={currentStatic.top} front={currentStatic.front} />
        <div class="live-samples"><span class:ready={recentQuaternionCount >= 8}></span>最近窗口 {recentQuaternionCount} 个姿态样本</div>
        <button class="primary" disabled={!orientation || recentQuaternionCount < 8} onclick={confirmStaticPose}>
          <Check size={18} /> 确认此姿态
        </button>
      {:else if stage === "dynamic" && currentDynamic}
        <div class="instruction-icon"><Rotate3D size={34} /></div>
        <span class="stage-label">动态轴 {dynamicIndex + 1}/3</span>
        <h3>{currentDynamic.title}</h3>
        <p class="instruction">先让目标颜色正对着你的眼睛。开始记录后，像转方向盘一样顺时针转动整颗魔方约 90°；不要拧任何单独一层。</p>
        <CalibrationGuide3D
          mode="dynamic"
          physicalAxis={currentDynamic.physicalAxis}
          positiveFace={currentDynamic.positiveFace}
        />
        <div class="recording-card" class:recording={dynamicRecording}>
          <span></span>
          <strong>{dynamicRecording ? "正在采集姿态与角速度" : "等待开始"}</strong>
          <small>{dynamicSampleCount} samples · 已转 {Math.round(detectedRotationDeg)}°</small>
        </div>
        {#if dynamicRecording}
          <div class="rotation-meter" class:ready={detectedRotationDeg >= 20}>
            <span style={`width:${Math.min(100, detectedRotationDeg / 90 * 100)}%`}></span>
          </div>
          <small class="rotation-hint">
            {detectedRotationDeg >= 20
              ? "已经检测到整机旋转，可以继续转到约 90° 后确认"
              : "请按动画转动整颗魔方，至少达到 20°"}
          </small>
          <button class="primary" disabled={detectedRotationDeg < 20} onclick={confirmDynamicCapture}><Check size={18} /> 完成并识别轴</button>
        {:else}
          <button class="primary" disabled={!orientation} onclick={startDynamicCapture}><Radio size={18} /> 开始记录</button>
        {/if}
      {:else if stage === "moves"}
        <div class="instruction-icon"><Radio size={34} /></div>
        <span class="stage-label">动作协议</span>
        <h3>执行公式验证面与方向</h3>
        <div class="algorithm">{#each expectedMoves as move}<strong>{move}</strong>{/each}</div>
        <p class="instruction">按标准记号执行一次。采集器会比较协议报告的面编号、顺逆时针和顺序。</p>
        <div class="observed"><span>收到</span><code>{observedMoves.join(" ") || "—"}</code></div>
        {#if moveRecording}
          <button class="primary" onclick={confirmMoves}><Check size={18} /> 完成并验证</button>
        {:else}
          <button class="primary" onclick={startMoveCapture}><Radio size={18} /> 开始记录公式</button>
          {#if observedMoves.length > 0 && !moveValidation.matched}
            <button class="secondary" onclick={continueWithMoveMismatch}>保留差异并继续</button>
          {/if}
        {/if}
      {:else if stage === "render"}
        <span class="stage-label">最终验证</span>
        <h3>对照实体魔方确认完整渲染</h3>
        <p class="instruction">逐面转动并整体旋转魔方，确认贴纸位置、动作方向和空间姿态都一致。</p>
        <div class="cube-preview"><Cube3D {cube} {orientation} {gyroCalibration} /></div>
        <div class="render-actions">
          <button class="secondary danger" onclick={() => confirmRender(false)}>仍然不一致</button>
          <button class="primary" onclick={() => confirmRender(true)}><Check size={18} /> 完全一致</button>
        </div>
      {:else if stage === "complete"}
        <div class="instruction-icon success"><ShieldCheck size={38} /></div>
        <span class="stage-label">采集完成</span>
        <h3>标定档案已生成</h3>
        <p class="instruction">已保存六个静态平均姿态、三轴映射、动作差异、字段候选位置和渲染确认。原始 BLE 帧与连续四元数没有写入 JSONL。</p>
        <div class="summary-grid">
          <article><strong>{staticCaptures.length}/6</strong><span>静态姿态</span></article>
          <article><strong>{dynamicCaptures.length}/3</strong><span>动态轴</span></article>
          <article><strong>{moveValidation.matched ? "一致" : "有差异"}</strong><span>动作映射</span></article>
          <article><strong>{renderConfirmed ? "通过" : "待修正"}</strong><span>渲染验证</span></article>
        </div>
        <div class="delivery-panel">
          <strong>怎么把结果给 Codex？</strong>
          <ol>
            <li>点击“导出并发给 Codex”，会下载一个 <code>cube-signal-profile-v4.json</code>。</li>
            <li>回到当前对话，把这个 JSON 文件直接拖进输入框发送。</li>
            <li>我会用里面的六面平均姿态、三轴方向和字段候选位置修协议并生成回归测试。</li>
          </ol>
        </div>
        <div class="export-actions">
          <button class="primary" onclick={downloadProfile}><Download size={18} /> 导出并发给 Codex</button>
          <button class="secondary" onclick={() => void copyProfile()}><ClipboardCopy size={18} /> 复制标定 JSON</button>
        </div>
        <button class="secondary" onclick={onclose}>完成</button>
      {/if}

      <p class="message">{message}</p>
    </main>

    {#if stage === "dynamic" || stage === "moves" || stage === "render"}
      <footer><button class="back" onclick={goBack}><ChevronLeft size={17} /> 返回上一步</button></footer>
    {/if}
  </div>
</div>

<style>
  .lab-backdrop {
    position: fixed; z-index: 80; inset: 0; display: grid; place-items: center;
    padding: 20px; background: rgb(5 8 8 / 0.78); backdrop-filter: blur(12px);
  }
  .lab-backdrop.standalone {
    position: relative; z-index: 0; min-height: 100vh; padding: clamp(12px, 3vw, 34px);
    background:
      radial-gradient(circle at 15% 10%, rgb(49 189 132 / 0.12), transparent 34%),
      var(--color-background);
  }
  .signal-lab {
    display: grid; width: min(760px, 100%); max-height: min(900px, calc(100vh - 40px));
    overflow: auto; border: 1px solid var(--color-outline); border-radius: 24px;
    color: var(--color-text); background: var(--color-surface); box-shadow: 0 30px 90px rgb(0 0 0 / 0.5);
  }
  .standalone .signal-lab { max-height: none; min-height: min(880px, calc(100vh - 68px)); }
  header { display: flex; align-items: start; justify-content: space-between; gap: 20px; padding: 24px 26px 18px; }
  header h2 { margin: 4px 0; font-size: 1.5rem; letter-spacing: -0.04em; }
  header p { margin: 0; color: var(--color-text-muted); font-size: 0.75rem; }
  .close { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 50%; color: inherit; background: var(--color-surface-highest); }
  .progress { height: 4px; background: var(--color-surface-highest); }
  .progress span { display: block; height: 100%; border-radius: 4px; background: var(--color-primary); transition: width 220ms ease; }
  main { display: grid; justify-items: center; gap: 14px; padding: 30px clamp(22px, 6vw, 58px); text-align: center; }
  .instruction-icon { display: grid; width: 68px; height: 68px; place-items: center; border-radius: 22px; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 13%, transparent); }
  .instruction-icon.success { color: #50d69c; }
  .stage-label, .eyebrow { color: var(--color-primary); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; }
  h3 { margin: 0; font-size: clamp(1.35rem, 4vw, 2rem); letter-spacing: -0.045em; }
  .instruction { max-width: 590px; margin: 0; color: var(--color-text-muted); font-size: 0.84rem; line-height: 1.7; }
  .live-samples { display: flex; align-items: center; gap: 8px; color: var(--color-text-muted); font-size: 0.75rem; }
  .live-samples span { width: 8px; height: 8px; border-radius: 50%; background: var(--color-warning); }
  .live-samples span.ready { background: #50d69c; box-shadow: 0 0 9px #50d69c; }
  button { border: 0; font: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: 0.42; }
  .primary, .secondary { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; padding: 0 18px; border-radius: 12px; font-weight: 750; }
  .primary { color: #06251a; background: var(--color-primary); }
  .secondary { color: var(--color-text); background: var(--color-surface-highest); }
  .secondary.danger { color: #ff948f; }
  .recording-card { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; width: min(420px, 100%); padding: 16px; border: 1px solid var(--color-outline); border-radius: 14px; text-align: left; }
  .recording-card > span { width: 10px; height: 10px; border-radius: 50%; background: var(--color-text-muted); }
  .recording-card.recording > span { background: #ff625e; box-shadow: 0 0 0 6px rgb(255 98 94 / 0.12); animation: pulse 1s infinite; }
  .recording-card small { color: var(--color-text-muted); }
  .rotation-meter { width: min(420px, 100%); height: 7px; overflow: hidden; border-radius: 999px; background: var(--color-surface-highest); }
  .rotation-meter span { display: block; height: 100%; border-radius: inherit; background: var(--color-warning); transition: width 120ms linear; }
  .rotation-meter.ready span { background: var(--color-primary); }
  .rotation-hint { color: var(--color-text-muted); font-size: 0.7rem; }
  .algorithm { display: flex; gap: 9px; padding: 15px 18px; border-radius: 14px; background: var(--color-surface-highest); }
  .algorithm strong { display: grid; min-width: 38px; height: 38px; place-items: center; border-radius: 9px; color: var(--color-primary); background: var(--color-surface); }
  .observed { display: grid; grid-template-columns: auto 1fr; gap: 12px; width: min(500px, 100%); padding: 12px 15px; border-radius: 12px; color: var(--color-text-muted); background: var(--color-surface-highest); text-align: left; }
  .observed code { color: var(--color-text); }
  .cube-preview { width: 100%; max-height: 370px; overflow: hidden; border: 1px solid var(--color-outline); border-radius: 18px; background: var(--color-surface-low); }
  .cube-preview :global(.cube-3d-wrap) { min-height: 330px; }
  .render-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); width: 100%; gap: 9px; }
  .summary-grid article { display: grid; gap: 5px; padding: 16px 8px; border-radius: 13px; background: var(--color-surface-highest); }
  .summary-grid strong { color: var(--color-primary); font-size: 1.1rem; }
  .summary-grid span { color: var(--color-text-muted); font-size: 0.68rem; }
  .delivery-panel { display: grid; width: 100%; gap: 8px; padding: 16px 18px; border: 1px solid var(--color-outline); border-radius: 14px; text-align: left; background: var(--color-surface-highest); }
  .delivery-panel strong { color: var(--color-primary); }
  .delivery-panel ol { display: grid; gap: 7px; margin: 0; padding-left: 20px; color: var(--color-text-muted); font-size: 0.74rem; line-height: 1.55; }
  .delivery-panel code { color: var(--color-text); }
  .export-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 9px; }
  .message { min-height: 20px; margin: 3px 0 0; color: var(--color-text-muted); font-size: 0.72rem; }
  footer { padding: 0 24px 20px; }
  .back { display: inline-flex; align-items: center; gap: 5px; color: var(--color-text-muted); background: transparent; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  @media (max-width: 599px) {
    .lab-backdrop { align-items: end; padding: 0; }
    .lab-backdrop.standalone { min-height: 100vh; padding: 0; }
    .signal-lab { max-height: 94vh; border-radius: 24px 24px 0 0; }
    .standalone .signal-lab { min-height: 100vh; max-height: none; border-radius: 0; }
    header { padding: 20px 20px 14px; }
    main { padding: 24px 18px; }
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
