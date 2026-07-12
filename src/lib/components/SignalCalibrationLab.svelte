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
  import type { CubeState, StickerPalette } from "$lib/cube/cube";
  import { gyroModelMatrix, type GyroCalibration } from "$lib/cube/orientation";
  import { recognizeCubePose } from "$lib/calibration/poseRecognition";
  import type {
    CubeQuaternion,
    CubeSignalFrameEvent,
    GanProtocolVersion,
  } from "$lib/protocols/gan/types";
  import {
    createSignalCalibrationProfile,
    deriveGyroCalibrationFromSignalProfile,
    averageQuaternions,
    quaternionAngularDistanceDeg,
    serializeSignalCalibrationProfile,
    summarizeFrameFieldEvidence,
    summarizeDynamicAxis,
    summarizeCompoundMotionValidation,
    summarizeMoveValidation,
    summarizeStaticPose,
    validatePoseGraphEdgeEndpoint,
    type CubeColor,
    type DynamicAxisCapture,
    type CompoundMotionValidationCapture,
    type SignalCalibrationProfile,
    type StaticPoseCapture,
    type TimedQuaternionSample,
    type TimedVelocitySample,
    type InMemorySignalFrame,
  } from "$lib/calibration/signalProfile";
  import { exportJsonFile } from "$lib/data/jsonExport";
  import { createContinuousPoseGraphEdges } from "$lib/calibration/calibrationGuide";

  let {
    deviceModel,
    protocol,
    firmwareVersion = "unknown",
    hardwareVersion = "unknown",
    cube,
    orientation,
    velocity,
    orientationSerial,
    moveSerial,
    lastMove,
    signalFrame,
    signalFrameSerial,
    gyroCalibration,
    stickerPalette,
    onclose,
    onsave,
    standalone = false,
  }: {
    deviceModel: string;
    protocol: GanProtocolVersion;
    firmwareVersion?: string;
    hardwareVersion?: string;
    cube: CubeState;
    orientation: CubeQuaternion | null;
    velocity: { x: number; y: number; z: number } | null;
    orientationSerial: number;
    moveSerial: number;
    lastMove: string | null;
    signalFrame: CubeSignalFrameEvent | null;
    signalFrameSerial: number;
    gyroCalibration: GyroCalibration;
    stickerPalette: StickerPalette;
    onclose: () => void;
    onsave: (profile: SignalCalibrationProfile) => void;
    standalone?: boolean;
  } = $props();

  type Stage = "static" | "dynamic" | "compound" | "moves" | "render" | "complete";
  type LiveOrientationRow = {
    at: number;
    q: CubeQuaternion;
    v: { x: number; y: number; z: number } | null;
  };

  const colorLabels: Record<CubeColor, string> = {
    white: "白色", yellow: "黄色", red: "红色", orange: "橙色", green: "绿色", blue: "蓝色",
  };
  const staticSteps: Array<{ top: CubeColor; front: CubeColor; title: string }> = [{
    top: "white",
    front: "green",
    title: "白色朝上 · 绿色朝前",
  }];
  const dynamicSteps = createContinuousPoseGraphEdges();
  const expectedMoves = ["R", "U", "R'", "U'"];

  let stage = $state<Stage>("static");
  let staticIndex = $state(0);
  let dynamicIndex = $state(0);
  let staticCaptures = $state<StaticPoseCapture[]>([]);
  let dynamicCaptures = $state<DynamicAxisCapture[]>([]);
  let dynamicRecording = $state(false);
  let compoundRecording = $state(false);
  let compoundCapture = $state<CompoundMotionValidationCapture | null>(null);
  let compoundSampleCount = $state(0);
  let moveRecording = $state(false);
  let observedMoves = $state<string[]>([]);
  let renderConfirmed = $state(false);
  let message = $state("保持魔方静止约 1 秒，再确认当前姿态。");
  let recentQuaternionCount = $state(0);
  let dynamicSampleCount = $state(0);
  let detectedRotationDeg = $state(0);
  let dynamicLayerMoves = $state<string[]>([]);
  let dynamicStartedAt = $state<number | null>(null);
  let dynamicStartPose = $state<StaticPoseCapture | null>(null);
  let initialAnchorCapture = $state<StaticPoseCapture | null>(null);
  let liveOrientationRows = $state<LiveOrientationRow[]>([]);
  let diagnosticJson = $state("");
  let diagnosticCopyStatus = $state("");
  let manualFormulaReference = $state<CubeQuaternion | null>(null);
  let lastLivePanelAt = 0;
  let lastOrientationSerial = -1;
  let lastMoveSerial = -1;
  let lastSignalFrameSerial = -1;
  let recentQuaternions: TimedQuaternionSample[] = [];
  let diagnosticQuaternions: TimedQuaternionSample[] = [];
  let dynamicVelocities: TimedVelocitySample[] = [];
  let dynamicQuaternions: TimedQuaternionSample[] = [];
  let compoundQuaternions: TimedQuaternionSample[] = [];
  let recentSignalFrames: InMemorySignalFrame[] = [];
  let diagnosticSignalFrames: InMemorySignalFrame[] = [];
  let staticSignalGroups: InMemorySignalFrame[][] = [];
  let staticFramesByPose: Record<string, InMemorySignalFrame[]> = {};
  let dynamicSignalGroups: Partial<Record<DynamicAxisCapture["physicalAxis"], InMemorySignalFrame[]>> = {};
  let dynamicSignalFrames: InMemorySignalFrame[] = [];
  let moveSignalFrames: InMemorySignalFrame[] = [];

  const totalProgressSteps = $derived(staticSteps.length + dynamicSteps.length + 4);
  const progress = $derived(
    stage === "static"
      ? staticIndex
      : stage === "dynamic"
        ? staticSteps.length + dynamicIndex
        : stage === "compound"
          ? staticSteps.length + dynamicSteps.length
        : stage === "moves"
          ? staticSteps.length + dynamicSteps.length + 1
          : stage === "render"
            ? staticSteps.length + dynamicSteps.length + 2
            : staticSteps.length + dynamicSteps.length + 3,
  );
  const currentStatic = $derived(staticSteps[staticIndex]);
  const currentDynamic = $derived(dynamicSteps[dynamicIndex]);
  const currentDynamicGuide = $derived(
    currentDynamic
      ? {
          top: currentDynamic.start.top,
          startFront: currentDynamic.start.front,
          endTop: currentDynamic.end.top,
          endFront: currentDynamic.end.front,
        }
      : null,
  );
  const moveValidation = $derived(summarizeMoveValidation(expectedMoves, observedMoves));
  const stableAverageQuaternion = $derived.by(() => {
    orientationSerial;
    if (recentQuaternions.length < 8) return null;
    const samples = recentQuaternions.filter((sample) => Date.now() - sample.at <= 1_200);
    if (samples.length < 8) return null;
    const average = averageQuaternions(samples.map((sample) => sample.quaternion));
    const maxDeviation = Math.max(
      ...samples.map((sample) => quaternionAngularDistanceDeg(sample.quaternion, average)),
    );
    if (maxDeviation > 5) return null;
    return average;
  });
  const capturedFormulaReference = $derived(
    initialAnchorCapture?.average ??
      staticCaptures.find((capture) => capture.top === "white" && capture.front === "green")?.average ??
      null,
  );
  const formulaGripReference = $derived(capturedFormulaReference ?? manualFormulaReference);
  const formulaGripDistanceDeg = $derived(
    stableAverageQuaternion && formulaGripReference
      ? quaternionAngularDistanceDeg(stableAverageQuaternion, formulaGripReference)
      : null,
  );
  const formulaGripMatches = $derived(
    formulaGripDistanceDeg !== null && formulaGripDistanceDeg <= 12,
  );
  const dynamicEndpointAngleDeg = $derived(
    dynamicStartPose && stableAverageQuaternion
      ? quaternionAngularDistanceDeg(dynamicStartPose.average, stableAverageQuaternion)
      : null,
  );
  const poseGraphClosureCount = $derived.by(() => {
    const observations = new Map<string, number>();
    for (const capture of dynamicCaptures) {
      for (const pose of [capture.startPose, capture.endPose]) {
        if (!pose) continue;
        const key = `${pose.top}/${pose.front}`;
        observations.set(key, (observations.get(key) ?? 0) + 1);
      }
    }
    return [...observations.values()].filter((count) => count > 1).length;
  });
  const coveredTopCount = $derived(new Set(staticCaptures.map((capture) => capture.top)).size);
  const derivedGyroCalibration = $derived(
    deriveGyroCalibrationFromSignalProfile({
      staticPoses: staticCaptures,
      dynamicAxes: dynamicCaptures,
    }),
  );
  const previewGyroCalibration = $derived(
    derivedGyroCalibration?.valid
      ? {
          ...gyroCalibration,
          zero: derivedGyroCalibration.zero,
          bodyToModel: derivedGyroCalibration.bodyToModel,
          relativeOrder: derivedGyroCalibration.relativeOrder,
          meanPoseErrorDeg: derivedGyroCalibration.meanPoseErrorDeg,
        }
      : gyroCalibration,
  );
  const centerFaceColors = $derived({
    U: cube.U[4], R: cube.R[4], F: cube.F[4],
    D: cube.D[4], L: cube.L[4], B: cube.B[4],
  });
  const recognizedLivePose = $derived(
    derivedGyroCalibration?.valid
      ? recognizeCubePose(orientation, previewGyroCalibration, centerFaceColors)
      : null,
  );
  const dynamicRecognizedEndpointMatches = $derived(
    Boolean(currentDynamic) &&
    recognizedLivePose?.topColor === currentDynamic?.end.top &&
    recognizedLivePose?.frontColor === currentDynamic?.end.front,
  );
  const dynamicEndpointReady = $derived(
    Boolean(stableAverageQuaternion) &&
    dynamicEndpointAngleDeg !== null &&
    currentDynamic !== undefined &&
    Math.abs(dynamicEndpointAngleDeg - currentDynamic.targetAngleDeg) <=
      (currentDynamic.targetAngleDeg === 180 ? 25 : 18) &&
    dynamicLayerMoves.length === 0,
  );
  const liveCubePoseMatrix = $derived(
    derivedGyroCalibration?.valid
      ? gyroModelMatrix(orientation, previewGyroCalibration)
      : null,
  );
  const compoundReturnTiltErrorDeg = $derived(
    liveCubePoseMatrix
      ? Math.acos(Math.max(-1, Math.min(1, liveCubePoseMatrix[1][1]))) * 180 / Math.PI
      : 180,
  );
  const compoundTableMatches = $derived(
    Boolean(stableAverageQuaternion) &&
    Boolean(recognizedLivePose?.confident) &&
    recognizedLivePose?.topColor === "white" &&
    recognizedLivePose?.frontColor === "green",
  );
  const compoundLiveCapture = $derived.by(() => {
    orientationSerial;
    if (!compoundRecording || compoundQuaternions.length < 20 ||
      !capturedFormulaReference || !orientation || !derivedGyroCalibration) return null;
    try {
      return summarizeCompoundMotionValidation(
        compoundQuaternions,
        capturedFormulaReference,
        orientation,
        compoundReturnTiltErrorDeg,
        derivedGyroCalibration,
      );
    } catch {
      return null;
    }
  });
  const displayedCompoundCapture = $derived(compoundLiveCapture ?? compoundCapture);
  const quaternionRanges = $derived.by(() => {
    orientationSerial;
    const samples = dynamicRecording && dynamicQuaternions.length > 0
      ? dynamicQuaternions
      : diagnosticQuaternions;
    if (samples.length === 0) return null;
    const axes = ["x", "y", "z", "w"] as const;
    return Object.fromEntries(axes.map((axis) => {
      const values = samples.map((sample) => sample.quaternion[axis]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      return [axis, { min, max, span: max - min }];
    })) as Record<"x" | "y" | "z" | "w", { min: number; max: number; span: number }>;
  });
  const changedByteIndexes = $derived.by(() => {
    signalFrameSerial;
    const sourceFrames = dynamicRecording && dynamicSignalFrames.length > 0
      ? dynamicSignalFrames
      : diagnosticSignalFrames;
    const gyroFrames = sourceFrames.filter((frame) => frame.packetType === "gyro");
    const referenceLength = gyroFrames[0]?.bytes.length;
    const frames = referenceLength === undefined
      ? []
      : gyroFrames.filter((frame) => frame.bytes.length === referenceLength);
    if (frames.length < 2) return [] as number[];
    const first = frames[0].bytes;
    const length = Math.min(...frames.map((frame) => frame.bytes.length));
    const indexes: number[] = [];
    for (let index = 0; index < length; index += 1) {
      if (frames.some((frame) => frame.bytes[index] !== first[index])) indexes.push(index);
    }
    return indexes;
  });
  const orientationRate = $derived.by(() => {
    orientationSerial;
    if (dynamicRecording && dynamicStartedAt) {
      const seconds = Math.max(0.1, (Date.now() - dynamicStartedAt) / 1_000);
      return dynamicSampleCount / seconds;
    }
    return recentQuaternionCount / 1.4;
  });
  const rollingRotationDeg = $derived.by(() => {
    orientationSerial;
    const start = diagnosticQuaternions[0]?.quaternion;
    if (!start) return 0;
    return diagnosticQuaternions.reduce(
      (maximum, sample) => Math.max(
        maximum,
        quaternionAngularDistanceDeg(start, sample.quaternion),
      ),
      0,
    );
  });
  const displayedRotationDeg = $derived(
    dynamicRecording ? detectedRotationDeg : rollingRotationDeg,
  );

  $effect(() => {
    const serial = orientationSerial;
    if (serial === lastOrientationSerial || !orientation) return;
    lastOrientationSerial = serial;
    const now = Date.now();
    recentQuaternions.push({ at: now, quaternion: { ...orientation } });
    recentQuaternions = recentQuaternions.filter((sample) => now - sample.at <= 1_400);
    diagnosticQuaternions.push({ at: now, quaternion: { ...orientation } });
    diagnosticQuaternions = diagnosticQuaternions.filter((sample) => now - sample.at <= 12_000);
    recentQuaternionCount = recentQuaternions.length;
    if (now - lastLivePanelAt >= 80) {
      lastLivePanelAt = now;
      liveOrientationRows = [
        { at: now, q: { ...orientation }, v: velocity ? { ...velocity } : null },
        ...liveOrientationRows,
      ].slice(0, 10);
    }
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
    if (compoundRecording) {
      compoundQuaternions.push({ at: now, quaternion: { ...orientation } });
      compoundSampleCount = compoundQuaternions.length;
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
    diagnosticSignalFrames.push(frame);
    diagnosticSignalFrames = diagnosticSignalFrames.filter((sample) => Date.now() - sample.at <= 12_000);
    if (dynamicRecording) dynamicSignalFrames.push(frame);
    if (moveRecording) moveSignalFrames.push(frame);
  });

  $effect(() => {
    const serial = moveSerial;
    if (serial === lastMoveSerial) return;
    lastMoveSerial = serial;
    if (dynamicRecording && lastMove) dynamicLayerMoves = [...dynamicLayerMoves, lastMove];
    if (moveRecording && lastMove) observedMoves = [...observedMoves, lastMove];
  });

  function recentPoseCapture(top: CubeColor, front: CubeColor): StaticPoseCapture {
    return summarizeStaticPose(
      top,
      front,
      recentQuaternions.filter((sample) => Date.now() - sample.at <= 1_200),
    );
  }

  function recentPoseFrames(): InMemorySignalFrame[] {
    return recentSignalFrames
      .filter((frame) => Date.now() - frame.at <= 1_200)
      .map((frame) => ({ ...frame, bytes: frame.bytes.slice() }));
  }

  function upsertStaticPose(capture: StaticPoseCapture, frames: InMemorySignalFrame[]): void {
    const poseKey = `${capture.top}/${capture.front}`;
    const index = staticCaptures.findIndex((candidate) =>
      candidate.top === capture.top && candidate.front === capture.front,
    );
    if (index < 0) {
      staticCaptures = [...staticCaptures, capture];
      staticFramesByPose = { ...staticFramesByPose, [poseKey]: frames };
      staticSignalGroups = staticCaptures.map((pose) =>
        staticFramesByPose[`${pose.top}/${pose.front}`] ?? [],
      );
      return;
    }
    if (capture.confidence >= staticCaptures[index].confidence) {
      staticCaptures = staticCaptures.map((candidate, candidateIndex) =>
        candidateIndex === index ? capture : candidate,
      );
      staticFramesByPose = { ...staticFramesByPose, [poseKey]: frames };
      staticSignalGroups = staticCaptures.map((pose) =>
        staticFramesByPose[`${pose.top}/${pose.front}`] ?? [],
      );
    }
  }

  function rebuildStaticNodes(): void {
    const nodes = [
      initialAnchorCapture,
      ...dynamicCaptures.flatMap((capture) => [capture.startPose, capture.endPose]),
    ].filter((capture): capture is StaticPoseCapture => Boolean(capture));
    const best = new Map<string, StaticPoseCapture>();
    for (const node of nodes) {
      const key = `${node.top}/${node.front}`;
      if (!best.has(key) || best.get(key)!.confidence <= node.confidence) best.set(key, node);
    }
    staticCaptures = [...best.values()];
    staticSignalGroups = staticCaptures.map((pose) =>
      staticFramesByPose[`${pose.top}/${pose.front}`] ?? [],
    );
  }

  function dynamicStepMatchesCapture(
    step: (typeof dynamicSteps)[number],
    capture: DynamicAxisCapture,
  ): boolean {
    return capture.startPose?.top === step.start.top &&
      capture.startPose.front === step.start.front &&
      capture.endPose?.top === step.end.top &&
      capture.endPose.front === step.end.front;
  }

  function dynamicStepTouchesPose(
    step: (typeof dynamicSteps)[number],
    top: CubeColor,
    front: CubeColor,
  ): boolean {
    return (step.start.top === top && step.start.front === front) ||
      (step.end.top === top && step.end.front === front);
  }

  function removeDynamicStepCapture(step: (typeof dynamicSteps)[number]): void {
    dynamicCaptures = dynamicCaptures.filter((capture) => !dynamicStepMatchesCapture(step, capture));
    rebuildStaticNodes();
  }

  function confirmStaticPose(): void {
    if (!currentStatic) return;
    try {
      const capture = recentPoseCapture(currentStatic.top, currentStatic.front);
      initialAnchorCapture = capture;
      upsertStaticPose(capture, recentPoseFrames());
      message = `已记录 ${capture.sampleCount} 个稳定样本，最大偏差 ${capture.maxAngularDeviationDeg}°。`;
      if (staticIndex + 1 >= staticSteps.length) {
        stage = "dynamic";
        message = "锚点已建立。接下来每条动态边会自动记录稳定起点和终点，生成完整 Pose Graph。";
      } else {
        staticIndex += 1;
        recentQuaternions = [];
        recentSignalFrames = [];
        recentQuaternionCount = 0;
        message = "已进入下一个独立姿态窗口，请重新摆放并保持稳定至少 1 秒。";
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }

  function startDynamicCapture(): void {
    if (!currentDynamic || !currentDynamicGuide) return;
    try {
      dynamicStartPose = recentPoseCapture(
        currentDynamicGuide.top,
        currentDynamicGuide.startFront,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      return;
    }
    upsertStaticPose(dynamicStartPose, recentPoseFrames());
    dynamicVelocities = [];
    dynamicQuaternions = [{ at: Date.now(), quaternion: { ...dynamicStartPose.average } }];
    dynamicSignalFrames = [];
    dynamicSampleCount = 0;
    detectedRotationDeg = 0;
    dynamicLayerMoves = [];
    dynamicStartedAt = Date.now();
    diagnosticJson = "";
    diagnosticCopyStatus = "";
    dynamicRecording = true;
    message = `起点 ${colorLabels[currentDynamicGuide.top]}上/${colorLabels[currentDynamicGuide.startFront]}前已自动记录。现在拿在空中自然转动整颗魔方，到 ${colorLabels[currentDynamicGuide.endTop]}上/${colorLabels[currentDynamicGuide.endFront]}前后停稳；不要拧任何单独一层。`;
  }

  function skipInitialAnchor(): void {
    initialAnchorCapture = null;
    stage = "dynamic";
    dynamicIndex = 0;
    message = "已跳过初始锚点。动态边仍会自动生成姿态节点，但公式握姿需要稍后手动设定。";
  }

  function skipDynamicAxis(): void {
    dynamicRecording = false;
    dynamicStartPose = null;
    rebuildStaticNodes();
    if (dynamicIndex + 1 >= dynamicSteps.length) {
      stage = "compound";
      message = "已跳过最后一条动态边，继续做空中全向组合验证。";
    } else {
      dynamicIndex += 1;
      message = "已跳过上一条姿态边；下一条会从它声明的起点继续。";
    }
  }

  function cancelDynamicCapture(): void {
    dynamicRecording = false;
    dynamicStartPose = null;
    rebuildStaticNodes();
    message = "本轮未保存。请按示意放稳起点后重新开始。";
  }

  function skipMoveValidation(): void {
    moveRecording = false;
    stage = "render";
    message = "已跳过公式验证；最终档案会保留为未验证状态。";
  }

  function confirmDynamicCapture(): void {
    if (!currentDynamic || !currentDynamicGuide || !dynamicStartPose) return;
    try {
      const endPose = recentPoseCapture(
        currentDynamicGuide.endTop,
        currentDynamicGuide.endFront,
      );
      const { endpointAngleDeg: endpointAngle } = validatePoseGraphEdgeEndpoint({
        startPose: dynamicStartPose,
        endPose,
        targetAngleDeg: currentDynamic.targetAngleDeg,
        layerMovesObserved: dynamicLayerMoves,
      });
      const axisCapture = summarizeDynamicAxis(
        currentDynamic.physicalAxis,
        currentDynamic.positiveFace,
        dynamicVelocities,
        dynamicQuaternions,
        currentDynamic.motionDirection,
        currentDynamic.targetAngleDeg,
      );
      const capture: DynamicAxisCapture = {
        ...axisCapture,
        startPose: dynamicStartPose,
        endPose,
        expectedEnd: { top: currentDynamicGuide.endTop, front: currentDynamicGuide.endFront },
        layerMovesObserved: [],
      };
      dynamicRecording = false;
      dynamicCaptures = [...dynamicCaptures, capture];
      upsertStaticPose(endPose, recentPoseFrames());
      dynamicSignalGroups[currentDynamic.physicalAxis] = [
        ...(dynamicSignalGroups[currentDynamic.physicalAxis] ?? []),
        ...dynamicSignalFrames.map((frame) => ({ ...frame, bytes: frame.bytes.slice() })),
      ];
      dynamicStartPose = null;
      message = `边与终点已记录：${colorLabels[currentDynamicGuide.endTop]}上/${colorLabels[currentDynamicGuide.endFront]}前，端点 ${endpointAngle.toFixed(1)}°。下一条会直接从当前姿态继续；当前已有 ${staticCaptures.length} 个唯一姿态节点。`;
      if (dynamicIndex + 1 >= dynamicSteps.length) {
        stage = "compound";
        message = "单轴采集完成。接下来做空中全向组合旋转，并回到白上绿前测量漂移。";
      } else {
        dynamicIndex += 1;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }

  function startCompoundCapture(): void {
    if (!capturedFormulaReference || !compoundTableMatches) {
      message = "请先在手中对准白色朝上、绿色朝前，并等待实时 3D 与姿态文字都显示匹配。";
      return;
    }
    compoundQuaternions = [];
    compoundSampleCount = 0;
    compoundCapture = null;
    compoundRecording = true;
    message = "正在记录：在空中缓慢覆盖绕红橙、白黄、绿蓝三个本体轴的旋转；实时覆盖条会告诉你还缺哪个方向，最后回到白上绿前。";
  }

  function confirmCompoundCapture(): void {
    if (!capturedFormulaReference || !stableAverageQuaternion || !compoundTableMatches) {
      message = "请在手中回到白上绿前并保持稳定约 1 秒；以实时 3D 和识别文字为准。";
      return;
    }
    try {
      compoundCapture = summarizeCompoundMotionValidation(
        compoundQuaternions,
        capturedFormulaReference,
        stableAverageQuaternion,
        compoundReturnTiltErrorDeg,
        derivedGyroCalibration ?? undefined,
      );
      compoundRecording = false;
      if (!compoundCapture.passed) {
        message = `组合验证未通过：路径 ${compoundCapture.pathRotationDeg}°，本体三轴覆盖 ${Math.round(compoundCapture.axisCoverage.x * 100)}/${Math.round(compoundCapture.axisCoverage.y * 100)}/${Math.round(compoundCapture.axisCoverage.z * 100)}%，回到白上姿态的倾斜 ${compoundCapture.returnTiltErrorDeg}°，绝对姿态差 ${compoundCapture.returnToReferenceErrorDeg}°。请继续补足较弱方向。`;
        return;
      }
      stage = "moves";
      message = `组合验证通过，回到白上姿态的倾斜 ${compoundCapture.returnTiltErrorDeg}°；绝对姿态差 ${compoundCapture.returnToReferenceErrorDeg}° 作为 session 漂移诊断保留。现在验证层转面编号和方向。`;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }

  function skipCompoundCapture(): void {
    compoundRecording = false;
    stage = "moves";
    message = "已跳过空中组合与漂移验证；最终模型置信度会降低。";
  }

  function startMoveCapture(force = false): void {
    if (!force && !formulaGripMatches) {
      message = "请先把白色中心朝上、绿色中心朝向你，等待基准握姿显示正确后再开始。";
      return;
    }
    observedMoves = [];
    moveSignalFrames = [];
    moveRecording = true;
    message = "正在记录动作，请完整执行 R U R' U'，随后点击验证。";
  }

  function setCurrentFormulaReference(): void {
    if (!stableAverageQuaternion) {
      message = "当前姿态仍在抖动，请稳定握持约 1 秒后再设为公式基准。";
      return;
    }
    manualFormulaReference = { ...stableAverageQuaternion };
    message = "已将当前白上绿前姿态设为本次公式基准。";
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

  function recaptureStaticPose(top: StaticPoseCapture["top"], front: StaticPoseCapture["front"]): void {
    if (top === "white" && front === "green" && initialAnchorCapture) {
      initialAnchorCapture = null;
      rebuildStaticNodes();
      staticIndex = 0;
      stage = "static";
      message = "重新采集初始白上绿前锚点；动态边和其他姿态节点会保留。";
      return;
    }
    const stepIndex = dynamicSteps.findIndex((step) =>
      dynamicCaptures.some((capture) => dynamicStepMatchesCapture(step, capture)) &&
      dynamicStepTouchesPose(step, top, front),
    );
    if (stepIndex < 0) {
      message = `没有找到生成 ${colorLabels[top]}上/${colorLabels[front]}前的已采动态边。`;
      return;
    }
    removeDynamicStepCapture(dynamicSteps[stepIndex]);
    dynamicIndex = stepIndex;
    dynamicRecording = false;
    dynamicStartPose = null;
    stage = "dynamic";
    message = `请重采生成 ${colorLabels[top]}上/${colorLabels[front]}前节点的动态边；其他节点和边会保留。`;
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
      firmwareVersion,
      hardwareVersion,
      staticPoses: staticCaptures,
      dynamicAxes: dynamicCaptures,
      moveValidation,
      renderValidation: { confirmed },
      compoundMotionValidation: compoundCapture ?? undefined,
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

  async function downloadProfile(): Promise<void> {
    const profile = buildProfile(renderConfirmed);
    try {
      const path = await exportJsonFile(
        `cube-signal-profile-${protocol}.json`,
        serializeSignalCalibrationProfile(profile),
      );
      message = `标定 JSON 已保存到 ${path}。把这个文件直接拖进 Codex 对话即可。`;
    } catch (error) {
      message = `导出标定 JSON 失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function copyProfile(): Promise<void> {
    const copied = await copyTextReliably(serializeSignalCalibrationProfile(buildProfile(renderConfirmed)));
    message = copied
      ? "标定 JSON 已复制。回到 Codex 对话直接粘贴即可。"
      : "自动复制失败，请使用文件导出。";
  }

  function createDiagnosticSnapshot(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      kind: "signal-lab-live-diagnostic",
      protocol,
      stage,
      dynamicAxis: currentDynamic?.physicalAxis ?? null,
      dynamicRecording,
      diagnosticWindow: dynamicRecording ? "active-recording" : "rolling-12-seconds",
      orientationSerial,
      signalFrameSerial,
      orientationRate: Number(orientationRate.toFixed(2)),
      quaternion: orientation,
      quaternionRanges,
      velocity,
      detectedRotationDeg: Number(displayedRotationDeg.toFixed(3)),
      dynamicSampleCount,
      compoundReturn: stage === "compound" ? {
        model: derivedGyroCalibration?.solver ?? null,
        bodyToModel: derivedGyroCalibration?.bodyToModel ?? null,
        relativeOrder: derivedGyroCalibration?.relativeOrder ?? null,
        tiltErrorDeg: Number(compoundReturnTiltErrorDeg.toFixed(3)),
        absoluteErrorDeg: formulaGripDistanceDeg === null
          ? null
          : Number(formulaGripDistanceDeg.toFixed(3)),
        tableMatched: compoundTableMatches,
      } : null,
      packetType: signalFrame?.packetType ?? null,
      packetLayer: signalFrame?.layer ?? null,
      packetLength: signalFrame?.bytes.length ?? 0,
      changedByteIndexes,
      observedLayerMoves: dynamicLayerMoves,
    };
  }

  async function copyTextReliably(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    }
  }

  async function copyDiagnosticSnapshot(): Promise<void> {
    diagnosticJson = JSON.stringify(createDiagnosticSnapshot(), null, 2);
    const copied = await copyTextReliably(diagnosticJson);
    diagnosticCopyStatus = copied
      ? "已复制到剪贴板，可以直接粘贴给 Codex。"
      : "自动复制被 WKWebView 拒绝；请在下方文本框按 ⌘A、⌘C，或下载 JSON。";
  }

  async function downloadDiagnosticSnapshot(): Promise<void> {
    diagnosticJson = JSON.stringify(createDiagnosticSnapshot(), null, 2);
    try {
      const path = await exportJsonFile(`cube-live-diagnostic-${protocol}.json`, diagnosticJson);
      diagnosticCopyStatus = `诊断 JSON 已保存到 ${path}，可以把文件直接拖进 Codex 对话。`;
    } catch (error) {
      diagnosticCopyStatus = `下载诊断 JSON 失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function goBack(): void {
    if (stage === "dynamic") {
      dynamicRecording = false;
      dynamicStartPose = null;
      if (dynamicIndex === 0) {
        stage = "static";
        staticIndex = 0;
        initialAnchorCapture = null;
        rebuildStaticNodes();
      } else {
        dynamicIndex -= 1;
        removeDynamicStepCapture(dynamicSteps[dynamicIndex]);
      }
    } else if (stage === "compound") {
      stage = "dynamic";
      dynamicIndex = dynamicSteps.length - 1;
      removeDynamicStepCapture(dynamicSteps[dynamicIndex]);
    } else if (stage === "moves") {
      stage = "compound";
      compoundCapture = null;
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
        <p>{deviceModel} · {protocol.toUpperCase()} · 步骤 {Math.min(progress + 1, totalProgressSteps)}/{totalProgressSteps}</p>
      </div>
      <button class="close" aria-label="关闭信号采集" onclick={onclose}><X size={20} /></button>
    </header>

    <div class="progress"><span style={`width:${(progress / Math.max(1, totalProgressSteps - 1)) * 100}%`}></span></div>

    <div class="lab-body">
    <main>
      {#if stage === "static" && currentStatic}
        <div class="instruction-icon"><Radio size={34} /></div>
        <span class="stage-label">初始人工锚点</span>
        <h3>{currentStatic.title}</h3>
        <p class="instruction">手持或放置都可以：白色中心朝上、绿色中心朝向你并保持至少 1 秒。只需人工确认这一个语义锚点；后续会沿一条连续的空中路径依次访问全部 24 个姿态，不需要反复回到固定起点。</p>
        <CalibrationGuide3D mode="static" top={currentStatic.top} front={currentStatic.front} />
        <div class="live-samples"><span class:ready={recentQuaternionCount >= 8}></span>最近窗口 {recentQuaternionCount} 个姿态样本</div>
        <div class="confirm-pose-row">
          <button class="primary" disabled={!stableAverageQuaternion} onclick={confirmStaticPose}>
            <Check size={18} /> 确认此姿态
          </button>
          <div class="pose-recognition" class:matched={Boolean(stableAverageQuaternion)}>
            {#if stableAverageQuaternion}
              <Check size={16} />
              <span>初始锚点已稳定，可以确认</span>
            {:else}
              <Radio size={16} /> <span>请按示意摆放并保持稳定…</span>
            {/if}
          </div>
        </div>
        <button class="skip-all" onclick={skipInitialAnchor}>跳过初始锚点（仅协议调试）</button>
      {:else if stage === "dynamic" && currentDynamic}
        <div class="instruction-icon"><Rotate3D size={34} /></div>
        <span class="stage-label">连续空中姿态边 {dynamicIndex + 1}/{dynamicSteps.length}</span>
        <h3>
          {colorLabels[currentDynamic.start.top]}上/{colorLabels[currentDynamic.start.front]}前
          → {colorLabels[currentDynamic.end.top]}上/{colorLabels[currentDynamic.end.front]}前
        </h3>
        <p class="instruction">不需要放在桌上，也不需要回到固定初始姿态。先按左侧起点稳定，开始后拿在空中用任意自然路径转动整颗魔方，最后对准右侧终点并停稳约 1 秒。只能转整颗魔方，不要拧任何单独一层。</p>
        <div class="pose-transition-guides">
          <div><strong>当前起点</strong><CalibrationGuide3D mode="static" top={currentDynamic.start.top} front={currentDynamic.start.front} /></div>
          <span class="transition-arrow">→</span>
          <div><strong>目标终点</strong><CalibrationGuide3D mode="static" top={currentDynamic.end.top} front={currentDynamic.end.front} /></div>
        </div>
        <div class="recording-card" class:recording={dynamicRecording}>
          <span></span>
          <strong>{dynamicRecording ? "正在采集姿态与角速度" : "等待开始"}</strong>
          <small>{dynamicSampleCount} samples · 已转 {Math.round(detectedRotationDeg)}°</small>
        </div>
        {#if dynamicRecording}
          {#if dynamicStartPose && currentDynamicGuide}
            <div class="pose-recognition matched">
              <Check size={16} />
              <span>
                起点已自动记录 · {colorLabels[currentDynamicGuide.top]}上/{colorLabels[currentDynamicGuide.startFront]}前
                · 置信度 {Math.round(dynamicStartPose.confidence * 100)}%
              </span>
            </div>
          {/if}
          {#if derivedGyroCalibration?.valid}
            <div class="dynamic-live-pose">
              <div class="cube-preview"><Cube3D {cube} {orientation} gyroCalibration={previewGyroCalibration} {stickerPalette} interactive={false} /></div>
              <div class="pose-recognition" class:matched={dynamicRecognizedEndpointMatches}>
                {#if recognizedLivePose}
                  {#if dynamicRecognizedEndpointMatches}<Check size={16} />{:else}<Rotate3D size={16} />{/if}
                  <span>
                    临时模型预览 {colorLabels[recognizedLivePose.topColor]}上/{colorLabels[recognizedLivePose.frontColor]}前
                    · 目标 {colorLabels[currentDynamic.end.top]}上/{colorLabels[currentDynamic.end.front]}前
                    · 仅供观察，不作为采集门槛
                  </span>
                {/if}
              </div>
            </div>
          {/if}
          <div class="rotation-meter" class:ready={dynamicEndpointReady}>
            <span style={`width:${Math.min(100, detectedRotationDeg / currentDynamic.targetAngleDeg * 100)}%`}></span>
          </div>
          <small class="rotation-hint">
            {#if dynamicLayerMoves.length > 0}
              已检测到层转，当前边不能保存
            {:else if !stableAverageQuaternion}
              {detectedRotationDeg >= currentDynamic.targetAngleDeg * 0.8
                ? `已经接近目标姿态，请停稳到 ${colorLabels[currentDynamicGuide?.endTop ?? "white"]}上/${colorLabels[currentDynamicGuide?.endFront ?? "green"]}前`
                : `请在空中转动整颗魔方，目标姿态差约 ${currentDynamic.targetAngleDeg}°`}
            {:else if dynamicEndpointReady && dynamicEndpointAngleDeg !== null}
              终点稳定 · 实测 {dynamicEndpointAngleDeg.toFixed(1)}° · 可以确认
            {:else if dynamicEndpointAngleDeg !== null}
              终点已稳定，但实测 {dynamicEndpointAngleDeg.toFixed(1)}°；请调整到 {colorLabels[currentDynamicGuide?.endTop ?? "white"]}上/{colorLabels[currentDynamicGuide?.endFront ?? "green"]}前
            {/if}
          </small>
          {#if dynamicLayerMoves.length > 0}
            <div class="layer-move-warning">
              检测到层转 {dynamicLayerMoves.join(" ")}，这条姿态边已污染。请停止本轮，复原层状态后只旋转整颗魔方。
            </div>
          {:else if dynamicSampleCount >= 80 && detectedRotationDeg < 2}
            <div class="gyro-still-warning">
              已收到 {dynamicSampleCount} 个姿态样本，但四元数角度几乎没有变化。如果你确认转动的是整颗魔方，这说明当前 GAN gyro 解码仍有问题，请保留这个页面状态。
            </div>
          {/if}
          <div class="step-actions">
            <button class="primary" disabled={detectedRotationDeg < currentDynamic.targetAngleDeg * 0.8 || !dynamicEndpointReady} onclick={confirmDynamicCapture}><Check size={18} /> 保存终点与动态边</button>
            <button class="secondary" onclick={cancelDynamicCapture}>停止并重来</button>
          </div>
        {:else}
          <div class="step-actions">
            <button class="primary" disabled={!stableAverageQuaternion} onclick={startDynamicCapture}><Radio size={18} /> 起点稳定，开始记录</button>
            <button class="secondary" onclick={skipDynamicAxis}>跳过此轴</button>
          </div>
          {#if !stableAverageQuaternion}
            <small class="rotation-hint">请先按示意放好起点并保持稳定约 1 秒。</small>
          {/if}
        {/if}
      {:else if stage === "compound"}
        <div class="instruction-icon"><Rotate3D size={34} /></div>
        <span class="stage-label">Held-out validation</span>
        <h3>空中全向覆盖与实时姿态检查</h3>
        <p class="instruction">全程拿在空中即可。开始前对准白上绿前；记录时分别绕红—橙、白—黄、绿—蓝三个本体轴大幅旋转，观察实时 3D 是否与手中一致，并把三个覆盖条都推过最低线。最后回到白上绿前并停稳。</p>
        <div class="compound-pose-board">
          <div>
            <strong>目标基准</strong>
            <CalibrationGuide3D mode="static" top="white" front="green" />
          </div>
          <div>
            <strong>实时识别</strong>
            <div class="cube-preview compound-preview"><Cube3D {cube} {orientation} gyroCalibration={previewGyroCalibration} {stickerPalette} interactive={false} /></div>
            <span class="live-pose-label">
              {#if recognizedLivePose}
                当前 {colorLabels[recognizedLivePose.topColor]}上 / {colorLabels[recognizedLivePose.frontColor]}前
                · 上 {Math.round(recognizedLivePose.topAlignment * 100)}%
                · 前 {Math.round(recognizedLivePose.frontAlignment * 100)}%
              {:else}
                标定模型尚未可用；请返回重采异常姿态边
              {/if}
            </span>
          </div>
        </div>
        <div class="pose-recognition formula-grip" class:matched={compoundTableMatches} class:mismatch={Boolean(stableAverageQuaternion) && !compoundTableMatches}>
          {#if stableAverageQuaternion && recognizedLivePose}
            {#if compoundTableMatches}<Check size={16} />{:else}<Radio size={16} />{/if}
            <span>
              {compoundTableMatches ? "实时 3D 已对齐白上绿前" : `当前识别为 ${colorLabels[recognizedLivePose.topColor]}上/${colorLabels[recognizedLivePose.frontColor]}前`}
              · 倾斜 {compoundReturnTiltErrorDeg.toFixed(1)}°
              {#if formulaGripDistanceDeg !== null} · 绝对姿态差 {formulaGripDistanceDeg.toFixed(1)}°（含 yaw 漂移，仅诊断）{/if}
            </span>
          {:else}
            <Radio size={16} /><span>等待白上绿前稳定姿态…</span>
          {/if}
        </div>
        <div class="recording-card" class:recording={compoundRecording}>
          <span></span>
          <strong>{compoundRecording ? "正在采集全向轨迹" : "等待开始"}</strong>
          <small>{compoundSampleCount} samples</small>
        </div>
        {#if displayedCompoundCapture}
          <div class="summary-grid">
            <article><strong>{displayedCompoundCapture.pathRotationDeg}°</strong><span>累计路径</span></article>
            <article><strong>{Math.round(displayedCompoundCapture.axisCoverage.x * 100)}%</strong><span>红—橙轴 X</span></article>
            <article><strong>{Math.round(displayedCompoundCapture.axisCoverage.y * 100)}%</strong><span>白—黄轴 Y</span></article>
            <article><strong>{Math.round(displayedCompoundCapture.axisCoverage.z * 100)}%</strong><span>绿—蓝轴 Z</span></article>
            <article><strong>{displayedCompoundCapture.passed ? "覆盖完成" : "继续旋转"}</strong><span>实时状态</span></article>
          </div>
        {/if}
        {#if compoundRecording}
          <div class="step-actions">
            <button class="primary" disabled={compoundSampleCount < 40 || !compoundTableMatches || !compoundLiveCapture?.passed} onclick={confirmCompoundCapture}><Check size={18} /> 已回到白上绿前，完成验证</button>
            <button class="secondary" onclick={() => (compoundRecording = false)}>停止并重来</button>
          </div>
        {:else}
          <div class="step-actions">
            <button class="primary" disabled={!compoundTableMatches} onclick={startCompoundCapture}><Radio size={18} /> 开始空中全向记录</button>
            <button class="secondary" onclick={skipCompoundCapture}>跳过此验证</button>
          </div>
        {/if}
      {:else if stage === "moves"}
        <div class="instruction-icon"><Radio size={34} /></div>
        <span class="stage-label">动作协议</span>
        <h3>执行公式验证面与方向</h3>
        <p class="instruction">先固定整颗魔方坐标：白色中心朝上，绿色中心朝向你，红色中心自然位于右手侧。整个公式过程中不要改变握姿。</p>
        <CalibrationGuide3D mode="static" top="white" front="green" />
        <div class="pose-recognition formula-grip" class:matched={formulaGripMatches} class:mismatch={formulaGripDistanceDeg !== null && !formulaGripMatches}>
          {#if formulaGripReference && formulaGripDistanceDeg !== null}
            <Check size={16} />
            <span>
              {formulaGripMatches ? "已回到公式基准" : "尚未对齐公式基准"}
              · 角度偏差 {formulaGripDistanceDeg.toFixed(1)}°
              · {capturedFormulaReference ? "来自 Pose Graph 白上绿前节点" : "本次手动设定"}
            </span>
          {:else if !formulaGripReference}
            <Radio size={16} /> <span>前面未采集白上绿前参考；摆好后请设为本次公式基准。</span>
          {:else}
            <Radio size={16} /> <span>正在与前面的白上绿前参考对齐，请保持魔方稳定…</span>
          {/if}
        </div>
        {#if !capturedFormulaReference}
          <button class="secondary" disabled={!stableAverageQuaternion} onclick={setCurrentFormulaReference}>
            将当前白上绿前姿态设为公式基准
          </button>
        {/if}
        <div class="algorithm">{#each expectedMoves as move}<strong>{move}</strong>{/each}</div>
        <div class="notation-guide">
          <article><strong>R</strong><span>右侧红色面</span><small>面对红面看，顺时针</small></article>
          <article><strong>U</strong><span>顶部白色面</span><small>从白面上方看，顺时针</small></article>
          <article><strong>R'</strong><span>右侧红色面</span><small>面对红面看，逆时针</small></article>
          <article><strong>U'</strong><span>顶部白色面</span><small>从白面上方看，逆时针</small></article>
        </div>
        <p class="instruction">基准握姿正确后再开始。采集器会比较协议报告的面编号、顺逆时针和顺序。</p>
        <div class="observed"><span>收到</span><code>{observedMoves.join(" ") || "—"}</code></div>
        {#if moveRecording}
          <div class="step-actions">
            <button class="primary" onclick={confirmMoves}><Check size={18} /> 完成并验证</button>
            <button class="secondary" onclick={skipMoveValidation}>跳过公式验证</button>
          </div>
        {:else}
          <div class="step-actions">
            <button class="primary" disabled={!formulaGripMatches} onclick={() => startMoveCapture()}><Radio size={18} /> 开始记录公式</button>
            <button class="secondary" onclick={skipMoveValidation}>跳过公式验证</button>
          </div>
          {#if !formulaGripMatches}
            <button class="skip-all" onclick={() => startMoveCapture(true)}>忽略姿态识别并开始（仅用于协议调试）</button>
          {/if}
          {#if observedMoves.length > 0 && !moveValidation.matched}
            <button class="secondary" onclick={continueWithMoveMismatch}>保留差异并继续</button>
          {/if}
        {/if}
      {:else if stage === "render"}
        <span class="stage-label">最终验证</span>
        <h3>对照实体魔方确认完整渲染</h3>
        <p class="instruction">逐面转动并整体旋转魔方，确认贴纸位置、动作方向和空间姿态都一致。</p>
        {#if derivedGyroCalibration}
          <div class="pose-recognition" class:matched={derivedGyroCalibration.valid} class:mismatch={!derivedGyroCalibration.valid}>
            {#if derivedGyroCalibration.valid}<Check size={16} />{:else}<X size={16} />{/if}
            <span>
              {derivedGyroCalibration.valid ? "刚体姿态模型可用" : "标定残差过大，禁止启用"}
              · 平均 {derivedGyroCalibration.meanPoseErrorDeg.toFixed(1)}°
              · 最大 {derivedGyroCalibration.maxPoseErrorDeg.toFixed(1)}°
              · 边误差 {derivedGyroCalibration.meanMotionEdgeErrorDeg.toFixed(1)}°
              · 置信度 {Math.round(derivedGyroCalibration.confidence * 100)}%
              · {derivedGyroCalibration.solver === "wahba-kabsch" ? "连续 SO(3)" : "24 轴离散"}
            </span>
          </div>
          {#if derivedGyroCalibration.rejectedPoseKeys.length > 0}
            <div class="bad-pose-list">
              <strong>建议只重采这些异常姿态</strong>
              {#each derivedGyroCalibration.poseResiduals.filter((item) => derivedGyroCalibration?.rejectedPoseKeys.includes(`${item.top}/${item.front}`)) as residual}
                <button class="secondary" onclick={() => recaptureStaticPose(residual.top, residual.front)}>
                  {colorLabels[residual.top]}上 / {colorLabels[residual.front]}前 · {residual.errorDeg.toFixed(1)}°
                </button>
              {/each}
            </div>
          {/if}
        {/if}
        <div class="cube-preview"><Cube3D {cube} {orientation} gyroCalibration={previewGyroCalibration} {stickerPalette} interactive={false} /></div>
        <div class="render-actions">
          <button class="secondary danger" onclick={() => confirmRender(false)}>仍然不一致</button>
          <button class="primary" disabled={!derivedGyroCalibration?.valid} onclick={() => confirmRender(true)}><Check size={18} /> 完全一致</button>
        </div>
      {:else if stage === "complete"}
        <div class="instruction-icon success"><ShieldCheck size={38} /></div>
        <span class="stage-label">采集完成</span>
        <h3>标定档案已生成</h3>
        <p class="instruction">已用 1 个人工语义锚点和 24 条连续空中姿态边访问完整 24 个姿态节点，最后一条边回到白上绿前形成闭环；同时保存完整 SO(3) 边误差、全向覆盖摘要、动作差异、字段候选位置和渲染确认。原始 BLE 帧与连续四元数没有写入 JSONL。</p>
        <div class="summary-grid">
          <article><strong>{staticCaptures.length}/24</strong><span>Pose Nodes</span></article>
          <article><strong>{dynamicCaptures.length}/{dynamicSteps.length}</strong><span>Motion Edges</span></article>
          <article><strong>{poseGraphClosureCount}</strong><span>Loop Closures</span></article>
          <article><strong>{coveredTopCount}/6</strong><span>Covered Tops</span></article>
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
          <button class="primary" onclick={() => void downloadProfile()}><Download size={18} /> 导出并发给 Codex</button>
          <button class="secondary" onclick={() => void copyProfile()}><ClipboardCopy size={18} /> 复制标定 JSON</button>
        </div>
        <button class="secondary" onclick={onclose}>完成</button>
      {/if}

      <p class="message">{message}</p>
    </main>

    <aside class="signal-stream" aria-label="实时协议数据流">
      <div class="stream-heading">
        <div>
          <span class="eyebrow">In-memory diagnostics</span>
          <h3>实时协议流</h3>
        </div>
        <span class="live-indicator" class:recording={dynamicRecording}><i></i> {dynamicRecording ? "RECORDING" : "IDLE · 12S ROLLING"}</span>
      </div>

      <div class="stream-metrics">
        <article><span>Orientation</span><strong>#{orientationSerial}</strong><small>{orientationRate.toFixed(1)} samples/s</small></article>
        <article><span>Signal frame</span><strong>#{signalFrameSerial}</strong><small>{signalFrame?.packetType ?? "—"} · {signalFrame?.bytes.length ?? 0} bytes</small></article>
        <article><span>最大角位移</span><strong>{displayedRotationDeg.toFixed(2)}°</strong><small>{dynamicRecording ? "本轮记录" : "最近 12 秒"}</small></article>
        <article><span>最后层转</span><strong>{lastMove ?? "—"}</strong><small>{dynamicLayerMoves.length} moves in axis capture</small></article>
      </div>

      <section class="stream-block">
        <div class="stream-block-title"><strong>Quaternion range</strong><span>{dynamicRecording ? "本轮记录" : "最近 12 秒"}</span></div>
        <div class="range-table">
          {#each ["x", "y", "z", "w"] as axis}
            <div>
              <b>{axis}</b>
              <code>{quaternionRanges ? quaternionRanges[axis as "x" | "y" | "z" | "w"].min.toFixed(4) : "—"}</code>
              <code>{quaternionRanges ? quaternionRanges[axis as "x" | "y" | "z" | "w"].max.toFixed(4) : "—"}</code>
              <strong>{quaternionRanges ? `Δ${quaternionRanges[axis as "x" | "y" | "z" | "w"].span.toFixed(4)}` : "—"}</strong>
            </div>
          {/each}
        </div>
      </section>

      <section class="stream-block">
        <div class="stream-block-title"><strong>解密帧变化</strong><span>{signalFrame?.layer ?? "—"}</span></div>
        <code class="byte-indexes">
          {changedByteIndexes.length > 0
            ? `changed indexes: ${changedByteIndexes.slice(0, 36).join(", ")}${changedByteIndexes.length > 36 ? "…" : ""}`
            : "尚未观察到字节变化"}
        </code>
      </section>

      <section class="stream-block live-table-block">
        <div class="stream-block-title"><strong>最近姿态帧</strong><span>约 12 FPS 展示</span></div>
        <div class="live-table" role="table" aria-label="最近姿态帧">
          <div class="live-table-head" role="row"><span>q.x</span><span>q.y</span><span>q.z</span><span>q.w</span><span>v.x/y/z</span></div>
          {#each liveOrientationRows as row}
            <div role="row">
              <code>{row.q.x.toFixed(3)}</code>
              <code>{row.q.y.toFixed(3)}</code>
              <code>{row.q.z.toFixed(3)}</code>
              <code>{row.q.w.toFixed(3)}</code>
              <code>{row.v ? `${row.v.x.toFixed(1)}/${row.v.y.toFixed(1)}/${row.v.z.toFixed(1)}` : "—"}</code>
            </div>
          {/each}
        </div>
      </section>

      <div class="diagnostic-actions">
        <button class="copy-diagnostic" onclick={() => void copyDiagnosticSnapshot()}>
          <ClipboardCopy size={15} /> 生成并复制诊断
        </button>
        <button class="copy-diagnostic" onclick={() => void downloadDiagnosticSnapshot()}>
          <Download size={15} /> 下载 JSON
        </button>
      </div>
      {#if diagnosticJson}
        <div class="diagnostic-output">
          <strong>{diagnosticCopyStatus}</strong>
          <textarea
            readonly
            aria-label="诊断 JSON"
            value={diagnosticJson}
            onfocus={(event) => event.currentTarget.select()}
          ></textarea>
        </div>
      {/if}
      <p class="stream-privacy">仅当前页面内存展示 · 不写 JSONL · 不保存原始 packet</p>
    </aside>
    </div>

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
    display: grid; width: min(1180px, 100%); max-height: min(920px, calc(100vh - 40px));
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
  .lab-body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; align-items: start; min-width: 0; }
  main { display: grid; min-width: 0; justify-items: center; gap: 14px; padding: 30px clamp(22px, 4vw, 52px); text-align: center; }
  .instruction-icon { display: grid; width: 68px; height: 68px; place-items: center; border-radius: 22px; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 13%, transparent); }
  .instruction-icon.success { color: #50d69c; }
  .stage-label, .eyebrow { color: var(--color-primary); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; }
  h3 { margin: 0; font-size: clamp(1.35rem, 4vw, 2rem); letter-spacing: -0.045em; }
  .instruction { max-width: 590px; margin: 0; color: var(--color-text-muted); font-size: 0.84rem; line-height: 1.7; }
  .live-samples { display: flex; align-items: center; gap: 8px; color: var(--color-text-muted); font-size: 0.75rem; }
  .live-samples span { width: 8px; height: 8px; border-radius: 50%; background: var(--color-warning); }
  .live-samples span.ready { background: #50d69c; box-shadow: 0 0 9px #50d69c; }
  .confirm-pose-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 9px; }
  .pose-transition-guides { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); width: 100%; align-items: center; gap: 10px; }
  .pose-transition-guides > div { display: grid; min-width: 0; justify-items: center; gap: 7px; color: var(--color-text-muted); font-size: 0.72rem; }
  .pose-transition-guides :global(.guide-card-3d) { width: 100%; padding-right: 4px; padding-left: 4px; overflow: hidden; }
  .pose-transition-guides :global(.guide-scene) { transform: scale(0.82); margin: -22px -28px; }
  .transition-arrow { color: var(--color-primary); font-size: 1.7rem; font-weight: 900; }
  .compound-pose-board { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; align-items: stretch; gap: 10px; }
  .compound-pose-board > div { display: grid; min-width: 0; justify-items: center; align-content: start; gap: 8px; padding: 10px; border: 1px solid var(--color-outline-soft); border-radius: 16px; background: var(--color-surface-highest); color: var(--color-text-muted); font-size: 0.72rem; }
  .compound-pose-board :global(.guide-card-3d) { width: 100%; padding-right: 4px; padding-left: 4px; overflow: hidden; }
  .compound-pose-board :global(.guide-scene) { transform: scale(0.82); margin: -22px -28px; }
  .compound-preview { max-height: 286px; }
  .compound-preview :global(.cube-3d-wrap) { min-height: 270px; }
  .live-pose-label { color: var(--color-primary); font-weight: 750; }
  .dynamic-live-pose { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(220px, auto); width: 100%; align-items: center; gap: 10px; }
  .dynamic-live-pose .cube-preview { max-height: 260px; }
  .dynamic-live-pose .cube-preview :global(.cube-3d-wrap) { min-height: 250px; }
  .pose-recognition { display: inline-flex; min-height: 38px; align-items: center; gap: 7px; padding: 8px 12px; border: 1px solid var(--color-outline); border-radius: 11px; color: var(--color-text-muted); background: var(--color-surface-highest); font-size: 0.72rem; }
  .pose-recognition.matched { color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 42%, transparent); background: color-mix(in srgb, var(--color-success) 8%, var(--color-surface-highest)); }
  .pose-recognition.mismatch { color: var(--color-warning); border-color: color-mix(in srgb, var(--color-warning) 38%, transparent); }
  .formula-grip { max-width: 100%; }
  button { border: 0; font: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: 0.42; }
  .primary, .secondary { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; padding: 0 18px; border-radius: 12px; font-weight: 750; }
  .primary { color: #06251a; background: var(--color-primary); }
  .secondary { color: var(--color-text); background: var(--color-surface-highest); }
  .secondary.danger { color: #ff948f; }
  .step-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 9px; }
  .skip-all { padding: 5px 8px; color: var(--color-text-muted); background: transparent; font-size: 0.7rem; text-decoration: underline; text-decoration-color: var(--color-outline); text-underline-offset: 4px; }
  .skip-all:hover { color: var(--color-primary); }
  .recording-card { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; width: min(420px, 100%); padding: 16px; border: 1px solid var(--color-outline); border-radius: 14px; text-align: left; }
  .recording-card > span { width: 10px; height: 10px; border-radius: 50%; background: var(--color-text-muted); }
  .recording-card.recording > span { background: #ff625e; box-shadow: 0 0 0 6px rgb(255 98 94 / 0.12); animation: pulse 1s infinite; }
  .recording-card small { color: var(--color-text-muted); }
  .rotation-meter { width: min(420px, 100%); height: 7px; overflow: hidden; border-radius: 999px; background: var(--color-surface-highest); }
  .rotation-meter span { display: block; height: 100%; border-radius: inherit; background: var(--color-warning); transition: width 120ms linear; }
  .rotation-meter.ready span { background: var(--color-primary); }
  .rotation-hint { color: var(--color-text-muted); font-size: 0.7rem; }
  .layer-move-warning { width: min(520px, 100%); padding: 11px 13px; border: 1px solid color-mix(in srgb, var(--color-error) 42%, transparent); border-radius: 12px; color: var(--color-error); background: color-mix(in srgb, var(--color-error) 8%, var(--color-surface-highest)); font-size: 0.72rem; line-height: 1.55; }
  .gyro-still-warning { width: min(520px, 100%); padding: 11px 13px; border: 1px solid color-mix(in srgb, var(--color-warning) 42%, transparent); border-radius: 12px; color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 8%, var(--color-surface-highest)); font-size: 0.72rem; line-height: 1.55; }
  .algorithm { display: flex; gap: 9px; padding: 15px 18px; border-radius: 14px; background: var(--color-surface-highest); }
  .algorithm strong { display: grid; min-width: 38px; height: 38px; place-items: center; border-radius: 9px; color: var(--color-primary); background: var(--color-surface); }
  .notation-guide { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; gap: 7px; }
  .notation-guide article { display: grid; min-width: 0; gap: 3px; padding: 10px 7px; border: 1px solid var(--color-outline-soft); border-radius: 11px; background: var(--color-surface-highest); }
  .notation-guide strong { color: var(--color-primary); font-size: 1rem; }
  .notation-guide span { color: var(--color-text); font-size: 0.68rem; }
  .notation-guide small { color: var(--color-text-muted); font-size: 0.58rem; line-height: 1.4; }
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
  .signal-stream { position: sticky; top: 0; display: grid; max-height: calc(100vh - 72px); gap: 12px; overflow: auto; padding: 22px 18px; border-left: 1px solid var(--color-outline-soft); background: color-mix(in srgb, var(--color-surface-high) 82%, transparent); text-align: left; }
  .stream-heading { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
  .stream-heading h3 { margin: 4px 0 0; font-size: 1.05rem; letter-spacing: -0.025em; }
  .live-indicator { display: inline-flex; align-items: center; gap: 6px; color: var(--color-success); font: 800 0.62rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .live-indicator:not(.recording) { color: var(--color-text-muted); }
  .live-indicator i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; animation: pulse 1s infinite; }
  .stream-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .stream-metrics article { display: grid; min-width: 0; gap: 3px; padding: 10px; border: 1px solid var(--color-outline-soft); border-radius: 11px; background: var(--color-surface); }
  .stream-metrics span, .stream-metrics small { overflow: hidden; color: var(--color-text-muted); font-size: 0.61rem; text-overflow: ellipsis; white-space: nowrap; }
  .stream-metrics strong { overflow: hidden; font: 750 0.86rem ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
  .stream-block { display: grid; gap: 8px; min-width: 0; padding: 11px; border: 1px solid var(--color-outline-soft); border-radius: 12px; background: var(--color-surface); }
  .stream-block-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .stream-block-title strong { font-size: 0.72rem; }
  .stream-block-title span { color: var(--color-text-muted); font-size: 0.61rem; }
  .range-table { display: grid; gap: 4px; }
  .range-table > div { display: grid; grid-template-columns: 18px 1fr 1fr 62px; gap: 5px; align-items: center; }
  .range-table b { color: var(--color-primary); font: 800 0.7rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .range-table code { color: var(--color-text-muted); font-size: 0.63rem; }
  .range-table strong { color: var(--color-info); font: 700 0.63rem ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
  .byte-indexes { display: block; overflow-wrap: anywhere; color: var(--color-info); font-size: 0.63rem; line-height: 1.55; }
  .live-table-block { overflow: hidden; }
  .live-table { display: grid; min-width: 0; gap: 2px; overflow: auto; }
  .live-table > div { display: grid; grid-template-columns: repeat(4, minmax(44px, 1fr)) minmax(88px, 1.5fr); gap: 4px; min-width: 295px; }
  .live-table span { color: var(--color-text-muted); font-size: 0.56rem; }
  .live-table code { color: var(--color-text); font-size: 0.59rem; font-variant-numeric: tabular-nums; }
  .live-table > div:not(.live-table-head):first-of-type code { color: var(--color-primary); }
  .stream-privacy { margin: 0; color: var(--color-text-muted); font-size: 0.58rem; line-height: 1.5; text-align: center; }
  .copy-diagnostic { display: inline-flex; min-height: 36px; align-items: center; justify-content: center; gap: 7px; padding: 0 10px; border: 1px solid var(--color-outline); border-radius: 10px; color: var(--color-primary); background: var(--color-surface-highest); font-size: 0.68rem; font-weight: 750; }
  .diagnostic-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .diagnostic-output { display: grid; gap: 7px; }
  .diagnostic-output strong { color: var(--color-warning); font-size: 0.64rem; line-height: 1.45; }
  .diagnostic-output textarea { width: 100%; min-height: 150px; resize: vertical; padding: 9px; border: 1px solid var(--color-outline); border-radius: 9px; color: var(--color-text); background: #0d1111; font: 0.58rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
  footer { padding: 0 24px 20px; }
  .back { display: inline-flex; align-items: center; gap: 5px; color: var(--color-text-muted); background: transparent; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  @media (max-width: 980px) {
    .lab-body { grid-template-columns: 1fr; }
    .signal-stream { position: relative; max-height: none; border-top: 1px solid var(--color-outline-soft); border-left: 0; }
  }
  @media (max-width: 599px) {
    .lab-backdrop { align-items: end; padding: 0; }
    .lab-backdrop.standalone { min-height: 100vh; padding: 0; }
    .signal-lab { max-height: 94vh; border-radius: 24px 24px 0 0; }
    .standalone .signal-lab { min-height: 100vh; max-height: none; border-radius: 0; }
    header { padding: 20px 20px 14px; }
    main { padding: 24px 18px; }
    .signal-stream { padding: 18px 12px 24px; }
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
    .notation-guide { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pose-transition-guides { grid-template-columns: 1fr; }
    .transition-arrow { transform: rotate(90deg); }
    .compound-pose-board { grid-template-columns: 1fr; }
    .dynamic-live-pose { grid-template-columns: 1fr; }
  }
</style>
