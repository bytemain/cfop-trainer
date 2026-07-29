import { createActor } from "xstate";
import type { BleConnection, CubeConnectionState, DiscoveredDevice } from "$lib/ble/types";
import { TauriBlecTransport } from "$lib/ble/tauriBlecTransport";
import {
  applyMove,
  applyMoves,
  cloneCube,
  createSolvedCube,
  cubeEquals,
  cubeStateFromFacelets,
  derivePhase,
  derivePhaseFacts,
  deriveF2lSlotFacts,
  invertAlgorithm,
  isSolved,
  normalizeMove,
  remapCubeColors,
  BRIGHT_STICKER_PALETTE,
  SOLVED_COLORS,
  type CubeState,
  type Face,
  type StickerColor,
  type StickerPalette,
} from "$lib/cube/cube";
import { ganProtocolAdapterFor, registerBuiltInGanProtocols } from "$lib/protocols/gan";
import type {
  CubeMoveEvent,
  CubeContinuityEvent,
  CubeOrientationEvent,
  CubeQuaternion,
  CubeSignalFrameEvent,
  SmartCubeSession,
} from "$lib/protocols/gan/types";
import {
  DEFAULT_DEVICE_CALIBRATION,
  DEFAULT_VIEW_PREFERENCE,
  GAN_V4_BODY_TO_MODEL,
  GAN_V4_POSE_CONTRACT_VERSION,
  GAN_V4_RELATIVE_ORDER,
  migrateGanV4ViewPreference,
  GAN_V4_SENSOR_AXES,
  composeGyroCalibration,
  type DeviceCalibration,
  type GyroCalibration,
  type SessionAnchor,
  type ViewPreference,
} from "$lib/cube/orientation";
import { trainingMachine, type TrainingMachineEvent } from "$lib/sessions/trainingMachine";
import { safeLogger } from "$lib/logging/safeLogger";
import {
  lastRememberedCubeDevice,
  rememberCubeDevice,
  type RememberedCubeDevice,
} from "$lib/data/database";
import {
  deriveGyroCalibrationFromSignalProfile,
  type SignalCalibrationProfile,
} from "$lib/calibration/signalProfile";
import { CubeClock, type CubeClockSample } from "$lib/timeline/cubeClock";
import { MoveTimeline, type MoveTimelineItem } from "$lib/timeline/moveTimeline";
import { PoseSession, type PoseHealth } from "$lib/pose/poseSession";
import {
  decideScrambleMove,
  scramblePrefixState,
  type ScrambleFault,
} from "$lib/sessions/scrambleGuidance";
import { streamRecorder } from "$lib/logging/streamRecorder";
import { DEFAULT_VIEW_PRESET_ID, viewPresetById, type ViewPresetId } from "$lib/cube/viewPresets";
import {
  matchesAxisDirection,
  relativeProtocolRotation,
} from "$lib/pose/relativeRotation";
import { reconstructSolve } from "$lib/analysis/solveReconstruction";
import { solveCrossOptimal } from "$lib/analysis/crossSolver";
import { reliableSnapshotMoveSequence } from "$lib/protocols/gan/sequence";
import {
  createEmptyGanV4ProtocolDiagnostics,
  GanV4ProtocolDiagnostics,
  type GanV4ProtocolDiagnosticSnapshot,
} from "$lib/protocols/gan/v4/diagnostics";

const SCRAMBLE_FACES = ["U", "R", "F", "D", "L", "B"] as const;
const SCRAMBLE_SUFFIXES = ["", "'", "2"] as const;
const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const GLOBAL_CUBE_PROFILE_KEY = "cfop-trainer:cube-profile:default";
const VIEW_PRESET_KEY = "cfop-trainer:view-preset";
const POSE_ANCHOR_RESTORE_MAX_AGE_MS = 30 * 60_000;

export interface ProtocolValidationStep {
  id: string;
  kind: "baseline" | "layer-move" | "whole-cube-rotation";
  title: string;
  instruction: string;
  expectedMove?: string;
  expectedAxis?: "x" | "y" | "z";
  expectedDirection?: "positive" | "negative";
}

export interface ProtocolValidationStepResult {
  stepId: string;
  status: "passed" | "mismatch" | "skipped";
  expectedMove?: string;
  observedMoves: string[];
  startSequence: number | null;
  endSequence: number | null;
  gyroSampleCount: number;
  maxGyroDeltaDeg: number;
  startQuaternion: CubeQuaternion | null;
  endQuaternion: CubeQuaternion | null;
  derivedRotationAxis?: { x: number; y: number; z: number };
  derivedRotationDeg?: number;
  derivedDominantAxis?: "x" | "y" | "z";
  derivedDirection?: "positive" | "negative";
  packetCountDelta: Partial<Record<CubeSignalFrameEvent["packetType"], number>>;
  issueCodes: string[];
  snapshotFacelets?: string;
  snapshotSequence?: number | null;
  batteryLevel?: number | null;
  completedAt: number;
}

export interface ProtocolSelfTestState {
  status: "idle" | "preparing" | "collecting" | "complete" | "failed";
  message: string;
  startedAt: number | null;
  stepIndex: number;
  observedMoves: string[];
  gyroSampleCount: number;
  maxGyroDeltaDeg: number;
  captureAnchored: boolean;
  results: ProtocolValidationStepResult[];
}

export const GAN_V4_VALIDATION_STEPS: ProtocolValidationStep[] = [
  {
    id: "baseline",
    kind: "baseline",
    title: "静止基准与当前六面",
    instruction: "保持白色中心朝上、绿色中心朝向你，不需要复原；静止后完成本步。",
  },
  ...(["R", "R'", "U", "U'", "F", "F'", "L", "L'", "D", "D'", "B", "B'"] as const).map((move) => ({
    id: `move-${move.replace("'", "-prime").toLowerCase()}`,
    kind: "layer-move" as const,
    title: `单层动作 ${move}`,
    instruction: `只执行一次 ${move}，完成后不要做其他动作，再确认本步。`,
    expectedMove: move,
  })),
  ...([
    ["x", "positive", "红—橙", "红", "逆时针"], ["x", "negative", "红—橙", "红", "顺时针"],
    ["y", "positive", "白—黄", "白", "逆时针"], ["y", "negative", "白—黄", "白", "顺时针"],
    ["z", "positive", "绿—蓝", "绿", "逆时针"], ["z", "negative", "绿—蓝", "绿", "顺时针"],
  ] as const).map(([axis, direction, colorAxis, viewpoint, turn]) => ({
    id: `rotation-${axis}-${direction}`,
    kind: "whole-cube-rotation" as const,
    title: `整颗绕${colorAxis}轴 · ${turn} 90°`,
    instruction: `先让${viewpoint}色面正对你：该面的法线沿你和魔方之间的视线前后方向。保持不动并点击“以当前姿态为起点”；再正面直视${viewpoint}色面，把整颗魔方${turn}旋转约 90°。不要拧任何单层。`,
    expectedAxis: axis,
    expectedDirection: direction,
  })),
];

const EMPTY_PROTOCOL_SELF_TEST: ProtocolSelfTestState = {
  status: "idle",
  message: "尚未开始渐进式真机协议验收",
  startedAt: null,
  stepIndex: 0,
  observedMoves: [],
  gyroSampleCount: 0,
  maxGyroDeltaDeg: 0,
  captureAnchored: false,
  results: [],
};

function generateScramble(length = 20): string[] {
  const moves: string[] = [];
  let previousFace: (typeof SCRAMBLE_FACES)[number] | null = null;

  while (moves.length < length) {
    const face = SCRAMBLE_FACES[Math.floor(Math.random() * SCRAMBLE_FACES.length)];
    if (face === previousFace) continue;
    const suffix = SCRAMBLE_SUFFIXES[Math.floor(Math.random() * SCRAMBLE_SUFFIXES.length)];
    moves.push(`${face}${suffix}`);
    previousFace = face;
  }

  return moves;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        clearTimeout(handle);
        reject(error);
      },
    );
  });
}

export const CONNECTION_LABELS: Record<CubeConnectionState, string> = {
  "bluetooth-unavailable": "蓝牙不可用",
  "permission-required": "需要蓝牙权限",
  idle: "未连接",
  scanning: "正在扫描",
  connecting: "正在连接",
  "discovering-services": "正在发现服务",
  authenticating: "正在识别协议",
  synchronizing: "正在同步状态",
  ready: "已连接",
  degraded: "连接降级",
  reconnecting: "正在重连",
  disconnected: "连接已断开",
  unsupported: "设备暂不支持",
};

export const PHASE_LABELS = {
  cross: "Cross",
  f2l: "F2L",
  oll: "OLL",
  pll: "PLL",
  done: "完成",
} as const;

class TrainerStore {
  connection = $state<CubeConnectionState>("idle");
  connectionMessage = $state("连接演示设备，或在 Tauri 真机中扫描 GAN 魔方。");
  devices = $state<DiscoveredDevice[]>([]);
  cube = $state<CubeState>(createSolvedCube());
  scramble = $state<string[]>([]);
  scrambleIndex = $state(0);
  scrambleFault = $state<ScrambleFault | null>(null);
  solveMoves = $state<string[]>([]);
  solveIndex = $state(0);
  elapsedMs = $state(0);
  sessionState = $state("idle");
  lastMove = $state<string | null>(null);
  eventCount = $state(0);
  hadDesync = $state(false);
  selectedMode = $state("full_cfop");
  crossColor = $state<StickerColor>("white");
  connectedDeviceName = $state<string | null>(null);
  battery = $state<number | null>(null);
  /** Last 0xED snapshot broadcast seen; the cube emits these even while stationary. */
  lastSnapshotAt = $state<number | null>(null);
  firmwareVersion = $state("unknown");
  hardwareVersion = $state("unknown");
  demoPlaying = $state(false);
  faceColors = $state({ ...SOLVED_COLORS });
  stickerPalette = $state<StickerPalette>({ ...BRIGHT_STICKER_PALETTE });
  deviceCalibration = $state<DeviceCalibration>({ ...DEFAULT_DEVICE_CALIBRATION });
  sessionAnchor = $state<SessionAnchor | null>(null);
  viewPreference = $state<ViewPreference>({ ...DEFAULT_VIEW_PREFERENCE });
  viewPresetId = $state<ViewPresetId>(DEFAULT_VIEW_PRESET_ID);
  poseHealth = $state<PoseHealth>({
    status: "initializing",
    message: "等待第一帧姿态",
    lastAcceptedAt: null,
    rejectedFrames: 0,
    reanchorCount: 0,
    lastStepDeg: null,
  });
  gyroQuaternion = $state<CubeQuaternion | null>(null);
  gyroVelocity = $state<{ x: number; y: number; z: number } | null>(null);
  cubeSequence = $state<number | null>(null);
  connectedProtocol = $state<"v1" | "v2" | "v3" | "v4" | null>(null);
  gyroEventSerial = $state(0);
  protocolMoveSerial = $state(0);
  lastProtocolMove = $state<string | null>(null);
  signalFrameSerial = $state(0);
  lastSignalFrame = $state<CubeSignalFrameEvent | null>(null);
  protocolDiagnostics = $state<GanV4ProtocolDiagnosticSnapshot>(createEmptyGanV4ProtocolDiagnostics());
  protocolSelfTest = $state<ProtocolSelfTestState>({ ...EMPTY_PROTOCOL_SELF_TEST });
  signalCalibrationProfile = $state<SignalCalibrationProfile | null>(null);
  timelineItems = $state<readonly MoveTimelineItem[]>([]);
  timelineContinuous = $state(true);
  crossSuggestion = $state<string[] | null>(null);

  phase = $derived(derivePhase(this.cube, this.crossColor));
  facts = $derived(derivePhaseFacts(this.cube, this.crossColor));
  currentScrambleMove = $derived(this.scramble[this.scrambleIndex] ?? null);
  currentSolveMove = $derived(this.solveMoves[this.solveIndex] ?? null);
  scrambleProgress = $derived(
    this.scramble.length === 0 ? 0 : this.scrambleIndex / this.scramble.length,
  );
  whiteYellowSwapped = $derived(
    this.faceColors.U === "yellow" && this.faceColors.D === "white",
  );
  reconstruction = $derived(reconstructSolve(this.timelineItems, this.crossColor));
  f2lSlots = $derived(deriveF2lSlotFacts(this.cube, this.crossColor));

  get gyroCalibration(): GyroCalibration {
    return composeGyroCalibration(this.deviceCalibration, this.sessionAnchor, this.viewPreference);
  }

  /**
   * The pose is aligned to the physical cube only after a semantic anchor:
   * quick calibration (manual) or signal-lab calibration. Session-start and
   * sensor-reset anchors track motion correctly but carry an arbitrary yaw,
   * because the GAN16ui IMU has no heading reference and its world-frame yaw
   * origin is random on every power cycle (measured 38-98 degree jumps
   * between reconnects); gravity fixes pitch and roll only.
   */
  private actor = createActor(trainingMachine);
  private startedAt: number | null = null;
  private completedMs = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private demoPlaybackHandle: ReturnType<typeof setInterval> | null = null;
  private scrambleBaseState: CubeState = createSolvedCube();
  private session: SmartCubeSession | null = null;
  private unsubscribeMoves: (() => Promise<void>) | null = null;
  private unsubscribeContinuity: (() => Promise<void>) | null = null;
  private unsubscribeOrientation: (() => Promise<void>) | null = null;
  private unsubscribeSignals: (() => Promise<void>) | null = null;
  private lastCubeSequence: number | undefined;
  private connectedDeviceId: string | null = null;
  private initializationPromise: Promise<void> | null = null;
  private preferencesInitialized = false;
  private initialSynchronizing = false;
  private initialMoveQueue: CubeMoveEvent[] = [];
  private cubeClock = new CubeClock();
  private moveTimeline = new MoveTimeline();
  private solveStartedCubeTime: number | null = null;
  private solveStartedEstimatedHostTime: number | null = null;
  private latestCubeClockSample: CubeClockSample | null = null;
  private poseSession = new PoseSession(this.deviceCalibration, this.viewPreference);
  private batteryRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private protocolInspector = new GanV4ProtocolDiagnostics();
  private protocolSelfTestStartQuaternion: CubeQuaternion | null = null;
  private protocolSelfTestStartSequence: number | null = null;
  private protocolSelfTestStartDiagnostics = createEmptyGanV4ProtocolDiagnostics();
  private protocolSelfTestSnapshot: { facelets: string; sequence: number | null } | null = null;
  private protocolSelfTestBattery: number | null = null;
  private poseContractVersion = 0;

  constructor() {
    registerBuiltInGanProtocols();
    safeLogger.info("app", "trainer-store-initialized");
    this.actor.subscribe((snapshot) => {
      this.sessionState = String(snapshot.value);
    });
    this.actor.start();
  }

  initialize(): Promise<void> {
    if (!this.preferencesInitialized) {
      this.loadPreferences(GLOBAL_CUBE_PROFILE_KEY);
      this.loadSignalCalibrationProfile(GLOBAL_CUBE_PROFILE_KEY + ":signal-calibration");
      if (typeof localStorage !== "undefined") {
        this.viewPresetId = viewPresetById(localStorage.getItem(VIEW_PRESET_KEY)).id;
      }
      this.preferencesInitialized = true;
    }
    this.initializationPromise ??= this.autoReconnectRememberedDevice();
    return this.initializationPromise;
  }

  private send(event: TrainingMachineEvent): void {
    this.actor.send(event);
  }

  async connectDemo(): Promise<void> {
    this.connection = "connecting";
    this.connectionMessage = "正在建立演示连接…";
    await new Promise((resolve) => setTimeout(resolve, 250));
    this.connection = "synchronizing";
    this.connectionMessage = "正在读取完整魔方状态…";
    await new Promise((resolve) => setTimeout(resolve, 250));
    this.connection = "ready";
    this.connectionMessage = "演示设备已同步。正式成绩必须来自真机协议 adapter。";
    this.cube = cubeStateFromFacelets(SOLVED_FACELETS, this.faceColors);
  }

  async scanRealDevices({ autoConnectSingle = true }: { autoConnectSingle?: boolean } = {}): Promise<void> {
    safeLogger.info("trainer", "scan-requested");
    this.connection = "scanning";
    this.connectionMessage = "正在扫描名称以 GAN 开头的 BLE 设备…";

    try {
      const transport = new TauriBlecTransport();
      if (!(await transport.requestPermissions())) {
        this.connection = "permission-required";
        this.connectionMessage = "未获得蓝牙权限。请在系统设置中允许后重试。";
        return;
      }

      if (!(await transport.isAvailable())) {
        this.connection = "bluetooth-unavailable";
        this.connectionMessage = "系统蓝牙当前不可用或尚未开启。";
        return;
      }

      this.devices = await transport.scan({ timeoutMs: 10_000, namePrefixes: ["GAN"] });
      safeLogger.info("trainer", "scan-result", {
        candidates: this.devices.length,
        names: this.devices.map((device) => device.name),
      });
      if (autoConnectSingle && this.devices.length === 1) {
        const [device] = this.devices;
        this.connectionMessage = `仅发现 ${device.name}，正在自动连接…`;
        safeLogger.info("trainer", "single-candidate-auto-connect", { name: device.name });
        await this.connectRealDevice(device);
        return;
      }
      this.connection = this.devices.length > 0 ? "idle" : "disconnected";
      this.connectionMessage =
        this.devices.length > 0
          ? `发现 ${this.devices.length} 个候选设备，请选择要连接的魔方。`
          : "未发现 GAN 候选设备。请确认魔方已唤醒并靠近本机。";
    } catch (error) {
      safeLogger.error("trainer", "scan-failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      this.connection = "disconnected";
      this.connectionMessage = `扫描失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async connectRealDevice(device: DiscoveredDevice): Promise<void> {
    let connection: BleConnection | null = null;
    this.connection = "connecting";
    this.connectionMessage = `正在连接 ${device.name}…`;
    safeLogger.info("trainer", "device-connect-requested", { name: device.name });

    try {
      await this.closeRealSession();
      this.connectedDeviceId = device.id;
      this.loadDevicePreferences(device.id);
      this.restorePersistedPoseAnchor();
      const adapter = ganProtocolAdapterFor(device);
      if (!adapter) {
        safeLogger.warn("trainer", "protocol-unsupported", { name: device.name });
        this.connection = "unsupported";
        this.connectionMessage = `${device.name} 暂未匹配到已实现的 GAN 协议。`;
        return;
      }
      if (adapter.version === "v4") {
        // GAN V4 mounting is a protocol/model constant. Discard obsolete
        // locally-derived axis mappings while preserving the user's gyro
        // enable/disable preference.
        this.deviceCalibration = {
          schemaVersion: 3,
          enabled: this.deviceCalibration.enabled,
          bodyToModel: GAN_V4_BODY_TO_MODEL,
          relativeOrder: GAN_V4_RELATIVE_ORDER,
          meanPoseErrorDeg: null,
          maxPoseErrorDeg: null,
        };
        const viewMigration = migrateGanV4ViewPreference(
          this.poseContractVersion,
          this.viewPreference,
        );
        this.viewPreference = viewMigration.preference;
        this.poseContractVersion = GAN_V4_POSE_CONTRACT_VERSION;
        this.poseSession.configure(this.deviceCalibration, this.viewPreference);
        safeLogger.info("calibration", "gan-v4-fixed-pose-contract-applied", {
          relativeOrder: GAN_V4_RELATIVE_ORDER,
          legacyViewCompensationCleared: viewMigration.migrated,
        });
        this.persistDevicePreferences();
      }

      const transport = new TauriBlecTransport();
      connection = await transport.connect(device);
      this.connection = "authenticating";
      this.connectionMessage = `已识别 ${adapter.version.toUpperCase()}，正在建立加密会话…`;
      safeLogger.info("trainer", "protocol-selected", {
        name: device.name,
        protocol: adapter.version,
      });
      this.session = await adapter.open(connection);
      this.connectedProtocol = adapter.version;
      connection = null;

      this.connection = "synchronizing";
      this.connectionMessage = "正在读取完整 54 格状态和 move counter…";
      this.initialSynchronizing = true;
      this.initialMoveQueue = [];
      this.unsubscribeMoves = await this.session.moves((event) => this.handleRealMove(event));
      this.unsubscribeContinuity = await this.session.continuity((event) => this.handleContinuity(event));
      this.unsubscribeOrientation = await this.session.orientation((event) => this.handleOrientation(event));
      this.unsubscribeSignals = await this.session.signals((event) => this.handleSignalFrame(event));
      const snapshot = await this.session.initialSnapshot();
      this.cube = cubeStateFromFacelets(snapshot.facelets, this.faceColors);
      const snapshotBaseline = reliableSnapshotMoveSequence(snapshot.sequence);
      this.lastCubeSequence = snapshotBaseline ?? undefined;
      this.cubeSequence = snapshotBaseline;
      if (snapshotBaseline === null) {
        safeLogger.info("trainer", "move-baseline-deferred", {
          reason: "initial-snapshot-zero-counter",
        });
      }
      this.resetSolveTimeline();
      this.initialSynchronizing = false;
      const queuedMoves = this.initialMoveQueue;
      this.initialMoveQueue = [];
      for (const queuedMove of queuedMoves) this.handleRealMove(queuedMove);
      this.connectedDeviceName = device.name;
      this.connection = "ready";
      this.connectionMessage = `${device.name} 已连接。`;
      streamRecorder.record("session", {
        event: "connected",
        protocol: adapter.version,
        firmware: this.firmwareVersion,
        hardware: this.hardwareVersion,
      });
      safeLogger.info("trainer", "device-ready", {
        name: device.name,
        protocol: adapter.version,
        sequence: snapshot.sequence ?? null,
      });

      try {
        await rememberCubeDevice({
          platform_device_id: device.id,
          display_name: device.name,
          model: device.name.toUpperCase().startsWith("GAN16UI") ? "GAN16 ui" : device.name,
          protocol_version: adapter.version,
          last_connected_at: Date.now(),
        });
        safeLogger.info("trainer", "remembered-device-saved", { name: device.name });
      } catch (error) {
        safeLogger.warn("trainer", "remembered-device-save-failed", {
          name: device.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      void this.refreshBatteryLevel();
      this.startBatteryPolling();
      void this.session.hardwareInfo().then((info) => {
        this.firmwareVersion = info?.softwareVersion ?? "unknown";
        this.hardwareVersion = info?.hardwareVersion ?? "unknown";
      }).catch(() => undefined);
    } catch (error) {
      safeLogger.error("trainer", "device-connect-failed", {
        name: device.name,
        reason: error instanceof Error ? error.message : String(error),
      });
      await connection?.disconnect().catch(() => undefined);
      await this.closeRealSession();
      this.connection = "disconnected";
      this.connectionMessage = `连接失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  prepareScramble(): void {
    this.stopTimer();
    this.stopDemoPlayback();
    if (!this.session) this.cube = cubeStateFromFacelets(SOLVED_FACELETS, this.faceColors);
    this.scramble = generateScramble();
    this.scrambleIndex = 0;
    this.scrambleFault = null;
    this.scrambleBaseState = cloneCube(this.cube);
    this.solveMoves = [];
    this.solveIndex = 0;
    this.elapsedMs = 0;
    this.completedMs = 0;
    this.lastMove = null;
    this.eventCount = 0;
    this.hadDesync = false;
    this.resetSolveTimeline();
    this.send({ type: "RESET" });
    this.send({ type: "PREPARE" });
  }

  applyNextScrambleMove(): void {
    if (this.sessionState !== "scrambling" || !this.currentScrambleMove) return;
    this.applyDomainMove(this.currentScrambleMove);
    this.scrambleIndex += 1;

    if (this.scrambleIndex === this.scramble.length) {
      this.solveMoves = invertAlgorithm(this.scramble);
      this.solveIndex = 0;
      this.send({ type: "SCRAMBLE_COMPLETE" });
    }
  }

  toggleDemoPlayback(): void {
    if (this.session || this.scramble.length === 0) return;
    if (this.demoPlaying) {
      this.stopDemoPlayback();
      return;
    }
    if (this.scrambleIndex >= this.scramble.length) this.resetDemoPlayback();
    this.demoPlaying = true;
    this.demoPlaybackHandle = setInterval(() => {
      this.demoStepForward();
      if (this.scrambleIndex >= this.scramble.length) this.stopDemoPlayback();
    }, 520);
  }

  demoStepForward(): void {
    if (this.session || this.scrambleIndex >= this.scramble.length) return;
    this.applyNextScrambleMove();
  }

  demoStepBack(): void {
    if (this.session || this.scrambleIndex <= 0) return;
    this.stopDemoPlayback();
    this.scrambleIndex -= 1;
    this.scrambleFault = null;
    const solved = cubeStateFromFacelets(SOLVED_FACELETS, this.faceColors);
    this.cube = applyMoves(solved, this.scramble.slice(0, this.scrambleIndex));
    this.solveMoves = [];
    this.solveIndex = 0;
    this.lastMove = this.scramble[this.scrambleIndex - 1] ?? null;
    this.eventCount = this.scrambleIndex;
    this.send({ type: "RESET" });
    this.send({ type: "PREPARE" });
  }

  resetDemoPlayback(): void {
    if (this.session) return;
    this.stopDemoPlayback();
    this.scrambleIndex = 0;
    this.scrambleFault = null;
    this.scrambleBaseState = cubeStateFromFacelets(SOLVED_FACELETS, this.faceColors);
    this.cube = cubeStateFromFacelets(SOLVED_FACELETS, this.faceColors);
    this.solveMoves = [];
    this.solveIndex = 0;
    this.lastMove = null;
    this.eventCount = 0;
    this.send({ type: "RESET" });
    this.send({ type: "PREPARE" });
  }

  applyNextSolveMove(): void {
    if (!this.currentSolveMove || !["ready", "running"].includes(this.sessionState)) return;

    if (this.sessionState === "ready") {
      this.startedAt = performance.now();
      this.startTimer();
      this.send({ type: "FIRST_MOVE" });
    }

    this.applyDomainMove(this.currentSolveMove);
    this.solveIndex += 1;

    if (isSolved(this.cube)) {
      this.completedMs = this.startedAt === null ? 0 : performance.now() - this.startedAt;
      this.elapsedMs = this.completedMs;
      this.stopTimer();
      this.send({ type: "SOLVED" });
    }
  }

  simulateDesync(): void {
    if (!["scrambling", "ready", "running"].includes(this.sessionState)) return;
    this.hadDesync = true;
    this.connection = "degraded";
    this.connectionMessage = "检测到 sequence gap。本次结果不会进入 PB，等待完整状态重同步。";
    this.stopTimer();
    this.send({ type: "DESYNC" });
  }

  async resync(): Promise<void> {
    this.connection = "synchronizing";
    if (this.session) {
      try {
        const snapshot = await this.session.requestSnapshot();
        const activeSequence = this.lastCubeSequence ?? snapshot.sequence;
        this.markTimelineDiscontinuity("manual-or-protocol-resync", activeSequence ?? null);
        this.cube = cubeStateFromFacelets(snapshot.facelets, this.faceColors);
        this.lastCubeSequence = activeSequence;
        this.cubeSequence = activeSequence ?? null;
      } catch (error) {
        this.connection = "degraded";
        this.connectionMessage = `重同步失败：${error instanceof Error ? error.message : String(error)}`;
        return;
      }
    } else {
      this.cube = cubeStateFromFacelets(SOLVED_FACELETS, this.faceColors);
    }
    this.scramble = [];
    this.scrambleIndex = 0;
    this.solveMoves = [];
    this.solveIndex = 0;
    this.elapsedMs = 0;
    this.lastMove = null;
    this.send({ type: "RESYNC" });
    this.connection = "ready";
    this.connectionMessage = this.session
      ? "魔方状态已重新同步。"
      : "演示状态已复位。";
  }

  async resetAndSyncCubeState(): Promise<boolean> {
    if (!this.session || !this.connectedDeviceName) {
      this.connectionMessage = "请先连接实体魔方，再重置并同步状态。";
      return false;
    }

    this.stopTimer();
    this.stopDemoPlayback();
    this.connection = "synchronizing";
    this.connectionMessage = "正在从 GAN 读取当前完整六面…";
    safeLogger.info("trainer", "manual-state-sync-start", {
      name: this.connectedDeviceName,
      activeSequence: this.lastCubeSequence,
    });

    try {
      const snapshot = await withTimeout(
        this.session.requestSnapshot(),
        12_000,
        "读取当前完整六面超时",
      );
      const activeSequence = this.lastCubeSequence ?? snapshot.sequence;
      this.applyCubeStateBaseline(cubeStateFromFacelets(snapshot.facelets, this.faceColors));
      this.lastCubeSequence = activeSequence;
      this.cubeSequence = activeSequence ?? null;
      this.connection = "ready";
      this.connectionMessage = `${this.connectedDeviceName} 的当前六面已同步。`;
      safeLogger.info("trainer", "manual-state-sync-complete", {
        name: this.connectedDeviceName,
        snapshotSequence: snapshot.sequence ?? null,
        activeSequence: activeSequence ?? null,
      });
      return true;
    } catch (error) {
      this.connection = "degraded";
      this.connectionMessage = `当前六面同步失败：${error instanceof Error ? error.message : String(error)}`;
      safeLogger.warn("trainer", "manual-state-sync-failed", {
        name: this.connectedDeviceName,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async assumeSolvedCubeState(): Promise<boolean> {
    if (!this.session || !this.connectedDeviceName) {
      this.connectionMessage = "请先连接实体魔方，再设置还原状态。";
      return false;
    }
    const deviceName = this.connectedDeviceName;
    this.stopTimer();
    this.stopDemoPlayback();
    this.connection = "synchronizing";
    this.connectionMessage = "正在按 CubeStation 协议向 GAN 写入复原 cubie state…";
    safeLogger.info("trainer", "manual-solved-state-write-start", { name: deviceName });
    try {
      const snapshot = this.session.writeSolvedState
        ? await withTimeout(this.session.writeSolvedState(), 12_000, "写入 GAN 复原状态超时")
        : {
            facelets: SOLVED_FACELETS,
            sequence: this.lastCubeSequence,
            receivedAt: Date.now(),
          };
      this.applyCubeStateBaseline(cubeStateFromFacelets(snapshot.facelets, this.faceColors));
      const activeSequence = reliableSnapshotMoveSequence(snapshot.sequence) ?? this.lastCubeSequence;
      this.lastCubeSequence = activeSequence;
      this.cubeSequence = activeSequence ?? null;
      this.connection = "ready";
      this.connectionMessage = this.session.writeSolvedState
        ? `${deviceName} 已写入复原状态，并通过 0xED 回读校验。`
        : `${deviceName} 已按用户确认设置为本地还原态。`;
      safeLogger.info("trainer", "manual-solved-baseline-applied", {
        name: deviceName,
        sequence: activeSequence ?? null,
        deviceWriteVerified: Boolean(this.session.writeSolvedState),
      });
      return true;
    } catch (error) {
      this.connection = "degraded";
      this.connectionMessage = `复原状态写入失败：${error instanceof Error ? error.message : String(error)}`;
      safeLogger.warn("trainer", "manual-solved-state-write-failed", {
        name: deviceName,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  get currentProtocolValidationStep(): ProtocolValidationStep | null {
    return GAN_V4_VALIDATION_STEPS[this.protocolSelfTest.stepIndex] ?? null;
  }

  get currentProtocolValidationRotation(): ReturnType<typeof relativeProtocolRotation> {
    if (!this.protocolSelfTest.captureAnchored) return null;
    return relativeProtocolRotation(this.protocolSelfTestStartQuaternion, this.gyroQuaternion);
  }

  async startProgressiveProtocolValidation(): Promise<void> {
    if (!this.session || this.connectedProtocol !== "v4") {
      this.protocolSelfTest = {
        ...EMPTY_PROTOCOL_SELF_TEST,
        status: "failed",
        message: "请先连接 GAN V4 魔方再开始协议验收。",
      };
      return;
    }

    this.protocolDiagnostics = this.protocolInspector.reset();
    this.protocolSelfTest = {
      ...EMPTY_PROTOCOL_SELF_TEST,
      status: "preparing",
      message: "正在请求当前六面与电量，建立静止基准…",
      startedAt: Date.now(),
    };
    this.beginProtocolValidationStep();

    try {
      const snapshot = await withTimeout(this.session.requestSnapshot(), 8_000, "当前六面请求超时");
      this.protocolSelfTestSnapshot = {
        facelets: snapshot.facelets,
        sequence: snapshot.sequence ?? null,
      };
      const battery = await withTimeout(this.session.batteryLevel(), 8_000, "电量请求超时");
      this.protocolSelfTestBattery = battery ?? null;
      this.protocolSelfTest = {
        ...this.protocolSelfTest,
        status: "collecting",
        message: GAN_V4_VALIDATION_STEPS[0].instruction,
      };
    } catch (error) {
      this.protocolSelfTest = {
        ...this.protocolSelfTest,
        status: "failed",
        message: `基准请求失败：${error instanceof Error ? error.message : String(error)}。仍可下载当前诊断。`,
      };
    }
  }

  completeProtocolValidationStep(forceMismatch = false): "passed" | "mismatch" | null {
    if (this.protocolSelfTest.status !== "collecting") return null;
    const step = this.currentProtocolValidationStep;
    if (!step) return null;

    const diagnosticsNow = this.protocolInspector.current();
    const packetCountDelta = Object.fromEntries(
      Object.entries(diagnosticsNow.packetCounts).map(([type, count]) => [
        type,
        count - (this.protocolSelfTestStartDiagnostics.packetCounts[type as CubeSignalFrameEvent["packetType"]] ?? 0),
      ]),
    ) as Partial<Record<CubeSignalFrameEvent["packetType"], number>>;
    const newIssueCodes = diagnosticsNow.issues
      .filter((issue) => !this.protocolSelfTestStartDiagnostics.issues.some((startIssue) =>
        startIssue.code === issue.code && startIssue.count === issue.count
      ))
      .map((issue) => issue.code);
    const endQuaternion = this.gyroQuaternion ? { ...this.gyroQuaternion } : null;
    const rotation = relativeProtocolRotation(this.protocolSelfTestStartQuaternion, endQuaternion);
    const observedMoves = [...this.protocolSelfTest.observedMoves];

    let passed = false;
    if (step.kind === "baseline") {
      passed = Boolean(this.protocolSelfTestSnapshot) &&
        this.protocolSelfTestBattery !== null &&
        this.protocolSelfTest.gyroSampleCount > 0 &&
        (packetCountDelta.invalid ?? 0) === 0;
    } else if (step.kind === "layer-move") {
      passed = observedMoves.length === 1 && observedMoves[0] === step.expectedMove;
    } else {
      const expectedAxis = step.expectedAxis ? GAN_V4_SENSOR_AXES[step.expectedAxis] : undefined;
      const axisReference = expectedAxis
        ? { x: expectedAxis[0], y: expectedAxis[1], z: expectedAxis[2] }
        : undefined;
      const angleAccepted = (rotation?.angleDeg ?? 0) >= 70 && (rotation?.angleDeg ?? 0) <= 110;
      const directionAccepted = !axisReference || !rotation
        ? true
        : matchesAxisDirection(rotation.axis, step.expectedDirection ?? "positive", axisReference);
      passed = this.protocolSelfTest.captureAnchored &&
        observedMoves.length === 0 &&
        Boolean(rotation) &&
        angleAccepted &&
        directionAccepted;
    }
    if (forceMismatch) passed = false;

    const resultStatus: "passed" | "mismatch" = passed ? "passed" : "mismatch";
    const result: ProtocolValidationStepResult = {
      stepId: step.id,
      status: resultStatus,
      expectedMove: step.expectedMove,
      observedMoves,
      startSequence: this.protocolSelfTestStartSequence,
      endSequence: this.cubeSequence,
      gyroSampleCount: this.protocolSelfTest.gyroSampleCount,
      maxGyroDeltaDeg: this.protocolSelfTest.maxGyroDeltaDeg,
      startQuaternion: this.protocolSelfTestStartQuaternion ? { ...this.protocolSelfTestStartQuaternion } : null,
      endQuaternion,
      derivedRotationAxis: rotation?.axis,
      derivedRotationDeg: rotation?.angleDeg,
      derivedDominantAxis: rotation?.dominantAxis,
      derivedDirection: rotation?.direction,
      packetCountDelta,
      issueCodes: newIssueCodes,
      snapshotFacelets: step.kind === "baseline" ? this.protocolSelfTestSnapshot?.facelets : undefined,
      snapshotSequence: step.kind === "baseline" ? this.protocolSelfTestSnapshot?.sequence : undefined,
      batteryLevel: step.kind === "baseline" ? this.protocolSelfTestBattery : undefined,
      completedAt: Date.now(),
    };
    this.advanceProtocolValidation(result);
    return resultStatus;
  }

  skipProtocolValidationStep(): void {
    if (this.protocolSelfTest.status !== "collecting") return;
    const step = this.currentProtocolValidationStep;
    if (!step) return;
    this.advanceProtocolValidation({
      stepId: step.id,
      status: "skipped",
      expectedMove: step.expectedMove,
      observedMoves: [...this.protocolSelfTest.observedMoves],
      startSequence: this.protocolSelfTestStartSequence,
      endSequence: this.cubeSequence,
      gyroSampleCount: this.protocolSelfTest.gyroSampleCount,
      maxGyroDeltaDeg: this.protocolSelfTest.maxGyroDeltaDeg,
      startQuaternion: this.protocolSelfTestStartQuaternion ? { ...this.protocolSelfTestStartQuaternion } : null,
      endQuaternion: this.gyroQuaternion ? { ...this.gyroQuaternion } : null,
      packetCountDelta: {},
      issueCodes: [],
      completedAt: Date.now(),
    });
  }

  skipToWholeCubeRotationValidation(): void {
    if (this.protocolSelfTest.status !== "collecting") return;
    while (this.currentProtocolValidationStep &&
      this.currentProtocolValidationStep.kind !== "whole-cube-rotation") {
      this.skipProtocolValidationStep();
    }
  }

  resetProgressiveProtocolValidation(): void {
    this.protocolDiagnostics = this.protocolInspector.reset();
    this.protocolSelfTest = { ...EMPTY_PROTOCOL_SELF_TEST };
    this.protocolSelfTestStartQuaternion = null;
    this.protocolSelfTestStartSequence = null;
    this.protocolSelfTestSnapshot = null;
    this.protocolSelfTestBattery = null;
  }

  anchorCurrentProtocolValidationStep(): void {
    if (this.protocolSelfTest.status !== "collecting") return;
    const step = this.currentProtocolValidationStep;
    if (step?.kind !== "whole-cube-rotation" || !this.gyroQuaternion) return;
    this.protocolSelfTestStartQuaternion = { ...this.gyroQuaternion };
    this.protocolSelfTestStartSequence = this.cubeSequence;
    this.protocolSelfTestStartDiagnostics = this.protocolInspector.current();
    this.protocolSelfTest = {
      ...this.protocolSelfTest,
      observedMoves: [],
      gyroSampleCount: 0,
      maxGyroDeltaDeg: 0,
      captureAnchored: true,
      message: `起点已锁定。${step.instruction.split("；").slice(1).join("；")}`,
    };
  }

  protocolValidationReport(): Record<string, unknown> {
    const currentStep = this.currentProtocolValidationStep;
    const currentEndQuaternion = this.gyroQuaternion ? { ...this.gyroQuaternion } : null;
    const currentRotation = relativeProtocolRotation(this.protocolSelfTestStartQuaternion, currentEndQuaternion);
    return {
      schemaVersion: 1,
      kind: "gan-v4-progressive-protocol-validation",
      createdAt: new Date().toISOString(),
      protocol: this.connectedProtocol,
      firmwareVersion: this.firmwareVersion,
      hardwareVersion: this.hardwareVersion,
      diagnostics: this.protocolInspector.current(),
      steps: GAN_V4_VALIDATION_STEPS,
      results: this.protocolSelfTest.results,
      protocolAxisContract: {
        bodyToModel: GAN_V4_BODY_TO_MODEL,
        relativeOrder: GAN_V4_RELATIVE_ORDER,
        sensorAxes: GAN_V4_SENSOR_AXES,
      },
      activeStepEvidence: currentStep ? {
        stepId: currentStep.id,
        expectedMove: currentStep.expectedMove,
        expectedAxis: currentStep.expectedAxis,
        expectedDirection: currentStep.expectedDirection,
        observedMoves: [...this.protocolSelfTest.observedMoves],
        startSequence: this.protocolSelfTestStartSequence,
        currentSequence: this.cubeSequence,
        gyroSampleCount: this.protocolSelfTest.gyroSampleCount,
        maxGyroDeltaDeg: this.protocolSelfTest.maxGyroDeltaDeg,
        startQuaternion: this.protocolSelfTestStartQuaternion
          ? { ...this.protocolSelfTestStartQuaternion }
          : null,
        currentQuaternion: currentEndQuaternion,
        derivedRotationAxis: currentRotation?.axis,
        derivedRotationDeg: currentRotation?.angleDeg,
        derivedDominantAxis: currentRotation?.dominantAxis,
        derivedDirection: currentRotation?.direction,
        snapshotFacelets: currentStep.kind === "baseline" ? this.protocolSelfTestSnapshot?.facelets : undefined,
        snapshotSequence: currentStep.kind === "baseline" ? this.protocolSelfTestSnapshot?.sequence : undefined,
        batteryLevel: currentStep.kind === "baseline" ? this.protocolSelfTestBattery : undefined,
      } : null,
      currentStepIndex: this.protocolSelfTest.stepIndex,
      currentStatus: this.protocolSelfTest.status,
      privacy: {
        containsRawBleBytes: false,
        containsMacAddress: false,
        containsCipherMaterial: false,
        containsContinuousQuaternionStream: false,
      },
    };
  }

  private beginProtocolValidationStep(autoAnchor = false): void {
    const step = this.currentProtocolValidationStep;
    const captureAnchored = step?.kind !== "whole-cube-rotation" || autoAnchor;
    this.protocolSelfTestStartQuaternion = captureAnchored && this.gyroQuaternion
      ? { ...this.gyroQuaternion }
      : null;
    this.protocolSelfTestStartSequence = this.cubeSequence;
    this.protocolSelfTestStartDiagnostics = this.protocolInspector.current();
    this.protocolSelfTestSnapshot = null;
    this.protocolSelfTestBattery = null;
    this.protocolSelfTest = {
      ...this.protocolSelfTest,
      observedMoves: [],
      gyroSampleCount: 0,
      maxGyroDeltaDeg: 0,
      captureAnchored,
    };
  }

  private advanceProtocolValidation(result: ProtocolValidationStepResult): void {
    const completedStep = this.currentProtocolValidationStep;
    const results = [...this.protocolSelfTest.results, result];
    const nextIndex = this.protocolSelfTest.stepIndex + 1;
    if (nextIndex >= GAN_V4_VALIDATION_STEPS.length) {
      this.protocolSelfTest = {
        ...this.protocolSelfTest,
        status: "complete",
        message: `协议验收完成：${results.filter((item) => item.status === "passed").length} 通过，${results.filter((item) => item.status === "mismatch").length} 不一致，${results.filter((item) => item.status === "skipped").length} 跳过。报告将自动下载；验收不会修改设备配置。`,
        stepIndex: nextIndex,
        results,
      };
      return;
    }
    this.protocolSelfTest = {
      ...this.protocolSelfTest,
      stepIndex: nextIndex,
      results,
      message: GAN_V4_VALIDATION_STEPS[nextIndex].instruction,
    };
    const nextStep = GAN_V4_VALIDATION_STEPS[nextIndex];
    const reusePreviousEndpoint = completedStep?.kind === "whole-cube-rotation" &&
      nextStep.kind === "whole-cube-rotation" &&
      completedStep.expectedAxis === nextStep.expectedAxis;
    this.beginProtocolValidationStep(reusePreviousEndpoint);
    if (reusePreviousEndpoint) {
      this.protocolSelfTest = {
        ...this.protocolSelfTest,
        message: `已沿用上一步终点作为起点。${nextStep.instruction.split("；").slice(1).join("；")}`,
      };
    }
  }

  private applyCubeStateBaseline(cube: CubeState): void {
    this.stopTimer();
    this.stopDemoPlayback();
    this.cube = cube;
    this.scramble = [];
    this.scrambleIndex = 0;
    this.solveMoves = [];
    this.solveIndex = 0;
    this.elapsedMs = 0;
    this.completedMs = 0;
    this.lastMove = null;
    this.eventCount = 0;
    this.hadDesync = false;
    this.resetSolveTimeline();
    this.send({ type: "RESET" });
  }

  reset(): void {
    this.stopTimer();
    this.stopDemoPlayback();
    if (!this.session) this.cube = cubeStateFromFacelets(SOLVED_FACELETS, this.faceColors);
    this.scramble = [];
    this.scrambleIndex = 0;
    this.solveMoves = [];
    this.solveIndex = 0;
    this.elapsedMs = 0;
    this.lastMove = null;
    this.eventCount = 0;
    this.hadDesync = false;
    this.resetSolveTimeline();
    this.send({ type: "RESET" });
  }

  setWhiteYellowSwapped(swapped: boolean): void {
    const next = {
      ...this.faceColors,
      U: swapped ? "yellow" as const : "white" as const,
      D: swapped ? "white" as const : "yellow" as const,
    };
    this.cube = remapCubeColors(this.cube, this.faceColors, next);
    this.faceColors = next;
    this.persistDevicePreferences();
  }

  setFaceColor(face: Face, color: StickerColor): void {
    const next = { ...this.faceColors, [face]: color };
    this.cube = remapCubeColors(this.cube, this.faceColors, next);
    this.faceColors = next;
    this.persistDevicePreferences();
  }

  setCrossColor(color: StickerColor): void {
    this.crossColor = color;
    this.persistDevicePreferences();
  }

  setStickerPaletteColor(color: StickerColor, value: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    this.stickerPalette = { ...this.stickerPalette, [color]: value.toLowerCase() };
    this.persistDevicePreferences();
  }

  resetStickerPalette(): void {
    this.stickerPalette = { ...BRIGHT_STICKER_PALETTE };
    this.persistDevicePreferences();
  }

  setViewPreset(id: ViewPresetId): void {
    this.viewPresetId = viewPresetById(id).id;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(VIEW_PRESET_KEY, this.viewPresetId);
    }
  }

  setGyroEnabled(enabled: boolean): void {
    this.deviceCalibration = { ...this.deviceCalibration, enabled };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.poseHealth = this.poseSession.currentHealth();
    this.persistDevicePreferences();
  }

  refreshGanV4RuntimePoseContract(): void {
    if (this.connectedProtocol !== "v4") return;
    if (this.deviceCalibration.relativeOrder === GAN_V4_RELATIVE_ORDER) return;
    this.deviceCalibration = {
      schemaVersion: 3,
      enabled: this.deviceCalibration.enabled,
      bodyToModel: GAN_V4_BODY_TO_MODEL,
      relativeOrder: GAN_V4_RELATIVE_ORDER,
      meanPoseErrorDeg: null,
      maxPoseErrorDeg: null,
    };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.persistDevicePreferences();
    safeLogger.info("calibration", "gan-v4-runtime-pose-contract-refreshed", {
      relativeOrder: GAN_V4_RELATIVE_ORDER,
    });
  }

  private adoptSessionAnchor(): void {
    this.sessionAnchor = this.poseSession.currentAnchor();
    this.poseHealth = this.poseSession.currentHealth();
    this.persistPoseAnchor();
  }

  private persistPoseAnchor(): void {
    if (typeof localStorage === "undefined" || !this.connectedDeviceId) return;
    const anchor = this.sessionAnchor;
    if (!anchor || (anchor.reason !== "manual" && anchor.reason !== "calibration")) return;
    try {
      localStorage.setItem(
        `cfop-trainer:cube-profile:${this.connectedDeviceId}:pose-anchor`,
        JSON.stringify({
          schemaVersion: 1,
          sensorReference: anchor.sensorReference,
          cubeReference: anchor.cubeReference,
          reason: anchor.reason,
          at: anchor.establishedAt,
        }),
      );
    } catch {
      // Storage pressure must never break calibration itself.
    }
  }

  private restorePersistedPoseAnchor(): void {
    if (typeof localStorage === "undefined" || !this.connectedDeviceId) return;
    const raw = localStorage.getItem(
      `cfop-trainer:cube-profile:${this.connectedDeviceId}:pose-anchor`,
    );
    if (!raw) return;
    try {
      const persisted = JSON.parse(raw) as {
        schemaVersion?: number;
        sensorReference?: { x: number; y: number; z: number; w: number };
        cubeReference?: number[][];
        reason?: string;
        at?: number;
      };
      const q = persisted.sensorReference;
      const ageMs = Date.now() - (persisted.at ?? 0);
      // The sensor world frame survives reconnects while the cube stays
      // powered, but a deep sleep resets its yaw origin; an anchor older than
      // the sleep threshold would display a garbage pose, so drop it and let
      // the session-start anchor plus the unaligned chip take over.
      if (
        persisted.schemaVersion !== 1 ||
        !q || ![q.x, q.y, q.z, q.w].every(Number.isFinite) ||
        !Array.isArray(persisted.cubeReference) ||
        (persisted.reason !== "manual" && persisted.reason !== "calibration") ||
        !Number.isFinite(ageMs) || ageMs < 0 || ageMs > POSE_ANCHOR_RESTORE_MAX_AGE_MS
      ) {
        return;
      }
      this.poseSession.restoreAnchor({
        sensorReference: q,
        cubeReference: persisted.cubeReference as [
          [number, number, number],
          [number, number, number],
          [number, number, number],
        ],
        establishedAt: persisted.at ?? Date.now(),
        reason: "restored",
      });
      this.adoptSessionAnchor();
      safeLogger.info("calibration", "pose-anchor-restored", {
        ageMs: Math.round(ageMs),
        originalReason: persisted.reason,
      });
    } catch {
      // Corrupt persisted anchors are ignored and recreated on calibration.
    }
  }

  zeroGyro(): void {
    if (!this.gyroQuaternion) return;
    this.poseSession.manuallyAnchor(this.gyroQuaternion);
    this.adoptSessionAnchor();
    streamRecorder.record("calibration", {
      event: "manual-anchor",
      quaternion: { ...this.gyroQuaternion },
    });
  }

  quickCalibrateWhiteUpGreenFront(): boolean {
    const poseAgeMs = this.poseHealth.lastAcceptedAt === null
      ? Number.POSITIVE_INFINITY
      : Date.now() - this.poseHealth.lastAcceptedAt;
    if (!this.gyroQuaternion || !this.deviceCalibration.enabled || poseAgeMs > 1_500) return false;
    // Quick calibration owns only the current session anchor. The persisted
    // sensor-to-cube mapping still comes from the full Pose Graph solver.
    this.viewPreference = { ...DEFAULT_VIEW_PREFERENCE };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.poseSession.manuallyAnchor(this.gyroQuaternion);
    this.adoptSessionAnchor();
    this.persistDevicePreferences();
    safeLogger.info("calibration", "quick-anchor-applied", {
      referencePose: "white-up-green-front",
      lastStepDeg: this.poseHealth.lastStepDeg,
    });
    streamRecorder.record("calibration", {
      event: "quick-anchor",
      referencePose: "white-up-green-front",
      quaternion: this.gyroQuaternion ? { ...this.gyroQuaternion } : null,
    });
    return true;
  }

  resetGyroCalibration(): void {
    this.deviceCalibration = { ...DEFAULT_DEVICE_CALIBRATION };
    this.viewPreference = { ...DEFAULT_VIEW_PREFERENCE };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.poseSession.resetPhysicalSession();
    this.sessionAnchor = null;
    this.poseHealth = this.poseSession.currentHealth();
    this.persistDevicePreferences();
  }

  setGyroOffset(axis: "X" | "Y" | "Z", value: number): void {
    this.viewPreference = { ...this.viewPreference, [`offset${axis}`]: value };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.persistDevicePreferences();
  }

  setGyroInverted(axis: "X" | "Y" | "Z", value: boolean): void {
    this.viewPreference = { ...this.viewPreference, [`invert${axis}`]: value };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.persistDevicePreferences();
  }

  saveSignalCalibrationProfile(profile: SignalCalibrationProfile): void {
    this.signalCalibrationProfile = profile;
    const derivedCalibration = profile.renderValidation.confirmed
      ? deriveGyroCalibrationFromSignalProfile(profile)
      : null;
    if (derivedCalibration?.valid && this.connectedProtocol !== "v4") {
      this.deviceCalibration = {
        schemaVersion: 3,
        enabled: this.deviceCalibration.enabled,
        bodyToModel: derivedCalibration.bodyToModel,
        relativeOrder: derivedCalibration.relativeOrder,
        meanPoseErrorDeg: derivedCalibration.meanPoseErrorDeg,
        maxPoseErrorDeg: derivedCalibration.maxPoseErrorDeg,
      };
      this.poseSession.configure(this.deviceCalibration, this.viewPreference);
      this.poseSession.bootstrap(derivedCalibration.zero);
      this.adoptSessionAnchor();
      this.persistDevicePreferences();
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(GLOBAL_CUBE_PROFILE_KEY + ":signal-calibration", JSON.stringify(profile));
      if (this.connectedDeviceId) {
        localStorage.setItem(
          "cfop-trainer:cube-profile:" + this.connectedDeviceId + ":signal-calibration",
          JSON.stringify(profile),
        );
      }
    }
    safeLogger.info("calibration", "signal-profile-saved", {
      protocol: profile.protocol,
      staticPoseCount: profile.staticPoses.length,
      dynamicAxisCount: profile.dynamicAxes.length,
      moveMappingMatched: profile.moveValidation.matched,
      renderConfirmed: profile.renderValidation.confirmed,
      confidence: profile.overallConfidence,
      gyroMappingApplied: Boolean(derivedCalibration?.valid && this.connectedProtocol !== "v4"),
      gyroMappingConfidence: derivedCalibration?.confidence,
    });
  }

  reprocessSavedSignalCalibration(): boolean {
    const profile = this.signalCalibrationProfile;
    if (!profile) return false;
    const derivedCalibration = deriveGyroCalibrationFromSignalProfile(profile);
    if (!derivedCalibration?.valid) return false;
    const reprocessedProfile: SignalCalibrationProfile = {
      ...profile,
      renderValidation: { confirmed: true },
      calibrationSolution: {
        valid: derivedCalibration.valid,
        solver: derivedCalibration.solver,
        meanPoseErrorDeg: derivedCalibration.meanPoseErrorDeg,
        maxPoseErrorDeg: derivedCalibration.maxPoseErrorDeg,
        meanMotionEdgeErrorDeg: derivedCalibration.meanMotionEdgeErrorDeg,
        poseResiduals: derivedCalibration.poseResiduals,
        rejectedPoseKeys: derivedCalibration.rejectedPoseKeys,
      },
    };
    this.signalCalibrationProfile = reprocessedProfile;
    if (this.connectedProtocol === "v4") {
      safeLogger.info("calibration", "signal-profile-reprocessed-diagnostic-only", {
        protocol: profile.protocol,
        reason: "gan-v4-uses-fixed-pose-contract",
      });
      return true;
    }
    this.deviceCalibration = {
      schemaVersion: 3,
      enabled: this.deviceCalibration.enabled,
      bodyToModel: derivedCalibration.bodyToModel,
      relativeOrder: derivedCalibration.relativeOrder,
      meanPoseErrorDeg: derivedCalibration.meanPoseErrorDeg,
      maxPoseErrorDeg: derivedCalibration.maxPoseErrorDeg,
    };
    // The previous manual offsets/inversions may have been compensating for
    // the broken axis-summary solver. An explicit reprocess starts from the
    // calibrated SSOT instead of stacking those historical corrections.
    this.viewPreference = { ...DEFAULT_VIEW_PREFERENCE };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.poseSession.bootstrap(derivedCalibration.zero);
    this.adoptSessionAnchor();
    this.persistDevicePreferences();
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        GLOBAL_CUBE_PROFILE_KEY + ":signal-calibration",
        JSON.stringify(reprocessedProfile),
      );
      if (this.connectedDeviceId) {
        localStorage.setItem(
          "cfop-trainer:cube-profile:" + this.connectedDeviceId + ":signal-calibration",
          JSON.stringify(reprocessedProfile),
        );
      }
    }
    safeLogger.info("calibration", "signal-profile-reprocessed", {
      protocol: profile.protocol,
      solver: derivedCalibration.solver,
      meanPoseErrorDeg: derivedCalibration.meanPoseErrorDeg,
      maxPoseErrorDeg: derivedCalibration.maxPoseErrorDeg,
      meanMotionEdgeErrorDeg: derivedCalibration.meanMotionEdgeErrorDeg,
    });
    return true;
  }

  formatTime(milliseconds = this.elapsedMs): string {
    const safeValue = Math.max(0, Math.floor(milliseconds));
    const minutes = Math.floor(safeValue / 60_000);
    const seconds = Math.floor((safeValue % 60_000) / 1_000);
    const millis = safeValue % 1_000;
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
  }

  computeCrossSuggestion(): void {
    const startState = this.reconstruction.replayStates[0];
    this.crossSuggestion = startState ? solveCrossOptimal(startState, this.crossColor, 8) : null;
  }

  private applyDomainMove(move: string): void {
    this.cube = applyMove(this.cube, move);
    this.lastMove = move;
    this.eventCount += 1;
  }

  private handleRealMove(event: CubeMoveEvent): void {
    if (this.initialSynchronizing) {
      this.initialMoveQueue.push(event);
      return;
    }
    if (this.lastCubeSequence !== undefined) {
      const gap = (event.sequence - this.lastCubeSequence) & 0xffff;
      if (gap === 0) {
        safeLogger.debug("trainer", "move-deduplicated", {
          sequence: event.sequence,
          move: event.move,
        });
        return;
      }
      if (gap > 1 && gap < 0x8000) {
        safeLogger.warn("trainer", "move-sequence-gap", {
          previousSequence: this.lastCubeSequence,
          sequence: event.sequence,
          gap,
        });
        this.hadDesync = true;
        this.connection = "degraded";
        this.connectionMessage = `检测到 move counter 跳变 ${gap} 步，正在请求完整状态恢复。`;
        this.stopTimer();
        if (["scrambling", "ready", "running"].includes(this.sessionState)) {
          this.send({ type: "DESYNC" });
        }
        this.lastCubeSequence = event.sequence;
        void this.resync();
        return;
      }
    }

    this.lastCubeSequence = event.sequence;
    this.cubeSequence = event.sequence;
    const move = normalizeMove(event.move);
    if (this.protocolSelfTest.status === "collecting" && this.protocolSelfTest.captureAnchored) {
      this.protocolSelfTest = {
        ...this.protocolSelfTest,
        observedMoves: [...this.protocolSelfTest.observedMoves, move],
      };
    }
    const clockSample = event.cubeTimestamp === undefined
      ? null
      : this.cubeClock.observe(event.cubeTimestamp, event.receivedAt);
    if (clockSample?.reset) {
      this.markTimelineDiscontinuity("device-clock-reset", event.sequence);
      this.hadDesync = true;
    }
    if (clockSample) this.latestCubeClockSample = clockSample;
    this.lastProtocolMove = move;
    this.protocolMoveSerial += 1;
    const stateBefore = cloneCube(this.cube);
    this.applyDomainMove(move);
    streamRecorder.record("move", {
      sequence: event.sequence,
      move,
      source: event.source ?? "live",
      cubeTime: clockSample?.cubeTime ?? null,
      receivedAt: event.receivedAt,
      protocol: event.protocol,
    });
    this.moveTimeline.appendMove({
      sequence: event.sequence,
      move,
      source: event.source ?? "live",
      cubeTime: clockSample?.cubeTime ?? null,
      hostReceivedAt: event.receivedAt,
      estimatedHostTime: clockSample?.estimatedHostTime ?? null,
      stateBefore,
      stateAfter: cloneCube(this.cube),
    });
    this.publishTimeline();

    if (this.sessionState === "scrambling") {
      const decision = decideScrambleMove({
        scramble: this.scramble,
        index: this.scrambleIndex,
        move,
        fault: this.scrambleFault,
        stateMatchesPrefix: cubeEquals(
          this.cube,
          scramblePrefixState(this.scrambleBaseState, this.scramble, this.scrambleIndex),
        ),
        stateMatchesPreviousPrefix: this.scrambleIndex > 0 && cubeEquals(
          this.cube,
          scramblePrefixState(this.scrambleBaseState, this.scramble, this.scrambleIndex - 1),
        ),
      });
      if (decision.kind === "advance") {
        this.scrambleIndex += 1;
        if (decision.clearFault) this.scrambleFault = null;
      } else if (decision.kind === "undo") {
        this.scrambleIndex -= 1;
      } else if (decision.kind === "recover") {
        this.scrambleFault = null;
      } else {
        this.scrambleFault = decision.fault;
      }
      if (this.scrambleIndex === this.scramble.length && !this.scrambleFault) {
        this.solveMoves = invertAlgorithm(this.scramble);
        this.solveIndex = 0;
        // Scramble telemetry is not part of the solve reconstruction. The
        // next move records this exact scrambled cube as stateBefore.
        this.resetSolveTimeline();
        this.send({ type: "SCRAMBLE_COMPLETE" });
      }
      return;
    }

    if (this.sessionState === "ready") {
      this.startedAt = performance.now();
      this.solveStartedCubeTime = clockSample?.cubeTime ?? null;
      this.solveStartedEstimatedHostTime = clockSample?.estimatedHostTime ?? null;
      this.startTimer();
      this.send({ type: "FIRST_MOVE" });
    }

    if (this.sessionState === "running" && isSolved(this.cube)) {
      this.completedMs = this.solveStartedCubeTime !== null && clockSample
        ? Math.max(0, clockSample.cubeTime - this.solveStartedCubeTime)
        : this.startedAt === null ? 0 : performance.now() - this.startedAt;
      this.elapsedMs = this.completedMs;
      this.stopTimer();
      this.send({ type: "SOLVED" });
    }
  }

  private async closeRealSession(): Promise<void> {
    this.stopBatteryPolling();
    if (this.session) {
      streamRecorder.record("session", { event: "disconnected" });
      void streamRecorder.flushNow();
    }
    await this.unsubscribeMoves?.().catch(() => undefined);
    this.unsubscribeMoves = null;
    await this.unsubscribeContinuity?.().catch(() => undefined);
    this.unsubscribeContinuity = null;
    await this.unsubscribeOrientation?.().catch(() => undefined);
    this.unsubscribeOrientation = null;
    await this.unsubscribeSignals?.().catch(() => undefined);
    this.unsubscribeSignals = null;
    await this.session?.disconnect().catch(() => undefined);
    this.session = null;
    this.connectedDeviceName = null;
    this.battery = null;
    this.lastSnapshotAt = null;
    this.scrambleFault = null;
    this.firmwareVersion = "unknown";
    this.hardwareVersion = "unknown";
    this.lastCubeSequence = undefined;
    this.cubeSequence = null;
    this.gyroQuaternion = null;
    this.gyroVelocity = null;
    this.connectedProtocol = null;
    this.lastSignalFrame = null;
    this.connectedDeviceId = null;
    this.initialSynchronizing = false;
    this.initialMoveQueue = [];
    this.cubeClock.reset();
    this.latestCubeClockSample = null;
    this.poseSession.resetPhysicalSession();
    this.sessionAnchor = null;
    this.poseHealth = this.poseSession.currentHealth();
  }

  private async refreshBatteryLevel(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      const level = await session.batteryLevel();
      if (session !== this.session || level == null) return;
      this.battery = Math.max(0, Math.min(100, Math.round(level)));
    } catch (error) {
      safeLogger.warn("trainer", "battery-refresh-failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private startBatteryPolling(): void {
    this.stopBatteryPolling();
    this.batteryRefreshTimer = setInterval(() => {
      void this.refreshBatteryLevel();
    }, 5 * 60_000);
  }

  private stopBatteryPolling(): void {
    if (this.batteryRefreshTimer) clearInterval(this.batteryRefreshTimer);
    this.batteryRefreshTimer = null;
  }

  private handleContinuity(event: CubeContinuityEvent): void {
    if (event.type === "history-recovery-started") {
      this.connection = "degraded";
      this.connectionMessage = `检测到动作缺口，正在从魔方历史记录恢复 ${event.previousSequence + 1}–${event.targetSequence}。`;
      return;
    }
    if (event.type === "history-recovered") {
      this.connection = "ready";
      this.connectionMessage = `${this.connectedDeviceName ?? "魔方"} 已补回丢失动作，时间线保持连续。`;
      return;
    }

    this.hadDesync = true;
    this.markTimelineDiscontinuity(
      event.reason ?? "protocol-discontinuity",
      event.snapshot?.sequence ?? event.targetSequence,
    );
    if (event.snapshot) {
      this.cube = cubeStateFromFacelets(event.snapshot.facelets, this.faceColors);
      const activeSequence = event.snapshot.sequence === 0 && event.targetSequence !== 0
        ? event.targetSequence
        : event.snapshot.sequence ?? event.targetSequence;
      this.lastCubeSequence = activeSequence;
      this.cubeSequence = activeSequence ?? null;
    }
    this.stopTimer();
    if (["scrambling", "ready", "running"].includes(this.sessionState)) {
      this.send({ type: "DESYNC" });
    }
    this.connection = event.snapshot ? "ready" : "degraded";
    this.connectionMessage = event.snapshot
      ? "历史动作恢复失败，已用完整状态继续；本段时间线已明确截断，不计入完整复盘。"
      : "动作历史和完整状态均恢复失败，请重新同步魔方状态。";
  }

  private markTimelineDiscontinuity(reason: string, snapshotSequence: number | null): void {
    this.moveTimeline.markDiscontinuity(
      reason,
      this.lastCubeSequence ?? null,
      snapshotSequence,
    );
    this.timelineContinuous = false;
    this.publishTimeline();
  }

  private resetSolveTimeline(): void {
    this.moveTimeline.reset();
    this.timelineContinuous = true;
    this.timelineItems = [];
    this.cubeClock.reset();
    this.latestCubeClockSample = null;
    this.solveStartedCubeTime = null;
    this.solveStartedEstimatedHostTime = null;
    this.crossSuggestion = null;
  }

  private publishTimeline(): void {
    this.timelineItems = [...this.moveTimeline.snapshot()];
  }

  private handleOrientation(event: CubeOrientationEvent): void {
    const observation = this.poseSession.observe(event.quaternion, event.receivedAt);
    this.poseHealth = observation.health;
    this.sessionAnchor = observation.anchor;
    streamRecorder.record("pose", {
      receivedAt: event.receivedAt,
      protocol: event.protocol,
      quaternion: { ...event.quaternion },
      accepted: observation.accepted,
      health: observation.health.status,
      stepDeg: observation.health.lastStepDeg,
      reanchorCount: observation.health.reanchorCount,
    });
    if (!observation.accepted || !observation.quaternion) {
      safeLogger.warn("pose", "orientation-rejected", {
        status: observation.health.status,
        rejectedFrames: observation.health.rejectedFrames,
        message: observation.health.message,
      });
      return;
    }
    this.gyroQuaternion = observation.quaternion;
    this.gyroVelocity = event.velocity ?? null;
    this.gyroEventSerial += 1;
    if (this.protocolSelfTest.status === "collecting") {
      const rotation = relativeProtocolRotation(this.protocolSelfTestStartQuaternion, observation.quaternion);
      this.protocolSelfTest = {
        ...this.protocolSelfTest,
        gyroSampleCount: this.protocolSelfTest.gyroSampleCount + 1,
        maxGyroDeltaDeg: Math.max(this.protocolSelfTest.maxGyroDeltaDeg, rotation?.angleDeg ?? 0),
      };
    }
  }

  private handleSignalFrame(event: CubeSignalFrameEvent): void {
    // The decoded frame is handed to the in-memory protocol inspector and to
    // the full-fidelity stream recorder (raw bytes, replayable offline). It
    // is never sent to the sanitized safeLogger channel.
    streamRecorder.recordFrame(
      event.protocol,
      event.layer,
      event.packetType,
      event.receivedAt,
      event.bytes,
    );
    this.lastSignalFrame = {
      ...event,
      bytes: event.bytes.slice(),
    };
    this.signalFrameSerial += 1;
    if (event.packetType === "snapshot") {
      this.lastSnapshotAt = event.receivedAt;
    }
    if (event.protocol === "v4") {
      this.protocolDiagnostics = this.protocolInspector.observe(event);
    }
  }

  private loadDevicePreferences(deviceId: string): void {
    // Color/view defaults may be global, but a sensor mounting solution must
    // never leak from one physical cube profile into another.
    this.deviceCalibration = { ...DEFAULT_DEVICE_CALIBRATION };
    this.viewPreference = { ...DEFAULT_VIEW_PREFERENCE };
    this.poseContractVersion = 0;
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.poseSession.resetPhysicalSession();
    this.sessionAnchor = null;
    this.loadPreferences("cfop-trainer:cube-profile:" + deviceId);
    this.loadSignalCalibrationProfile(
      "cfop-trainer:cube-profile:" + deviceId + ":signal-calibration",
    );
  }

  private loadSignalCalibrationProfile(storageKey: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const decoded = JSON.parse(raw) as { schemaVersion?: number; profileKind?: string; staticPoses?: unknown; dynamicAxes?: unknown };
      if (
        (decoded.schemaVersion === 1 || decoded.schemaVersion === 2) &&
        decoded.profileKind === "smart-cube-signal-calibration" &&
        Array.isArray(decoded.staticPoses) &&
        Array.isArray(decoded.dynamicAxes)
      ) {
        const profile = decoded as unknown as SignalCalibrationProfile;
        this.signalCalibrationProfile = profile;
        const derivedCalibration = profile.renderValidation.confirmed
          ? deriveGyroCalibrationFromSignalProfile(profile)
          : null;
        if (derivedCalibration?.valid) {
          this.deviceCalibration = {
            schemaVersion: 3,
            enabled: this.deviceCalibration.enabled,
            bodyToModel: derivedCalibration.bodyToModel,
            relativeOrder: derivedCalibration.relativeOrder,
            meanPoseErrorDeg: derivedCalibration.meanPoseErrorDeg,
            maxPoseErrorDeg: derivedCalibration.maxPoseErrorDeg,
          };
          this.poseSession.configure(this.deviceCalibration, this.viewPreference);
          // Device mapping persists; the absolute sensor reference does not.
          // The first accepted packet creates a fresh SessionAnchor.
        }
      }
    } catch {
      // Invalid or obsolete calibration profiles can be replaced by rerunning the lab.
    }
  }

  private loadPreferences(storageKey: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const profile = JSON.parse(raw) as {
        poseContractVersion?: number;
        faceColors?: Record<Face, StickerColor>;
        crossColor?: StickerColor;
        stickerPalette?: Partial<StickerPalette>;
        gyroCalibration?: GyroCalibration;
        deviceCalibration?: DeviceCalibration;
        viewPreference?: ViewPreference;
      };
      this.poseContractVersion = Number.isFinite(profile.poseContractVersion)
        ? Number(profile.poseContractVersion)
        : 0;
      if (profile.faceColors) this.faceColors = { ...SOLVED_COLORS, ...profile.faceColors };
      if (profile.crossColor) this.crossColor = profile.crossColor;
      if (profile.stickerPalette) {
        this.stickerPalette = { ...BRIGHT_STICKER_PALETTE, ...profile.stickerPalette };
      }
      if (profile.deviceCalibration?.schemaVersion === 3) {
        this.deviceCalibration = { ...DEFAULT_DEVICE_CALIBRATION, ...profile.deviceCalibration };
      } else if (profile.gyroCalibration) {
        this.deviceCalibration = {
          ...DEFAULT_DEVICE_CALIBRATION,
          enabled: profile.gyroCalibration.enabled ?? true,
          bodyToModel: profile.gyroCalibration.bodyToModel ?? null,
          relativeOrder: profile.gyroCalibration.relativeOrder ?? GAN_V4_RELATIVE_ORDER,
          meanPoseErrorDeg: profile.gyroCalibration.meanPoseErrorDeg ?? null,
          maxPoseErrorDeg: profile.gyroCalibration.maxPoseErrorDeg ?? null,
        };
      }
      this.viewPreference = profile.viewPreference
        ? { ...DEFAULT_VIEW_PREFERENCE, ...profile.viewPreference }
        : profile.gyroCalibration
          ? {
              offsetX: profile.gyroCalibration.offsetX ?? 0,
              offsetY: profile.gyroCalibration.offsetY ?? 0,
              offsetZ: profile.gyroCalibration.offsetZ ?? 0,
              invertX: profile.gyroCalibration.invertX ?? false,
              invertY: profile.gyroCalibration.invertY ?? false,
              invertZ: profile.gyroCalibration.invertZ ?? false,
            }
          : { ...DEFAULT_VIEW_PREFERENCE };
      this.poseSession.configure(this.deviceCalibration, this.viewPreference);
      this.adoptSessionAnchor();
    } catch {
      // Invalid local calibration is ignored and can be recreated in Settings.
    }
  }

  private persistDevicePreferences(): void {
    if (typeof localStorage === "undefined") return;
    const value = JSON.stringify({
      poseContractVersion: this.poseContractVersion,
      faceColors: this.faceColors,
      crossColor: this.crossColor,
      stickerPalette: this.stickerPalette,
      deviceCalibration: this.deviceCalibration,
      viewPreference: this.viewPreference,
    });
    localStorage.setItem(GLOBAL_CUBE_PROFILE_KEY, value);
    if (this.connectedDeviceId) {
      localStorage.setItem("cfop-trainer:cube-profile:" + this.connectedDeviceId, value);
    }
  }

  private async autoReconnectRememberedDevice(): Promise<void> {
    let remembered: RememberedCubeDevice | null;
    try {
      remembered = await lastRememberedCubeDevice();
    } catch (error) {
      // Browser preview and first-run database failures should not prevent the
      // trainer UI from loading. Tauri JSONL still captures the safe reason.
      safeLogger.debug("trainer", "remembered-device-load-unavailable", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!remembered) return;

    const rememberedName = remembered.display_name ?? remembered.model ?? "上次连接的 GAN 魔方";
    this.connection = "reconnecting";
    this.connectionMessage = `正在后台寻找 ${rememberedName}…转动魔方即可自动重连。`;
    safeLogger.info("trainer", "auto-reconnect-start", { name: rememberedName });

    try {
      const transport = new TauriBlecTransport();
      if (!(await transport.requestPermissions())) {
        this.connection = "permission-required";
        this.connectionMessage = "已记住上次设备，但当前没有蓝牙权限。";
        return;
      }
      if (!(await transport.isAvailable())) {
        this.connection = "bluetooth-unavailable";
        this.connectionMessage = "已记住上次设备，但系统蓝牙当前未开启。";
        return;
      }

      const retained = await transport.connectedDevice();
      const retainedTarget = retained && (
        retained.id === remembered.platform_device_id ||
        retained.name === remembered.display_name
      ) ? retained : null;
      if (retainedTarget) {
        this.devices = [retainedTarget];
        safeLogger.info("trainer", "auto-reconnect-reusing-native-connection", {
          name: retainedTarget.name,
        });
        this.connectionMessage = `正在恢复 ${retainedTarget.name} 的协议会话…`;
        await this.connectRealDevice(retainedTarget);
        return;
      }

      const candidates = await withTimeout(
        transport.scan({ timeoutMs: 10_000, namePrefixes: ["GAN"] }),
        15_000,
        "自动重连扫描超时",
      );
      this.devices = candidates;
      const target =
        candidates.find((device) => device.id === remembered.platform_device_id) ??
        candidates.find((device) => device.name === remembered.display_name);
      safeLogger.info("trainer", "auto-reconnect-scan-result", {
        name: rememberedName,
        candidates: candidates.length,
        matched: Boolean(target),
      });

      if (!target) {
        this.connection = "disconnected";
        this.connectionMessage = `已记住 ${rememberedName}，但它当前没有广播。转动魔方后可重新扫描。`;
        return;
      }

      await this.connectRealDevice(target);
    } catch (error) {
      safeLogger.warn("trainer", "auto-reconnect-failed", {
        name: rememberedName,
        reason: error instanceof Error ? error.message : String(error),
      });
      this.connection = "disconnected";
      this.connectionMessage = `自动重连 ${rememberedName} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private startTimer(): void {
    if (this.timerHandle !== null) clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      if (this.solveStartedEstimatedHostTime !== null) {
        this.elapsedMs = Math.max(0, Date.now() - this.solveStartedEstimatedHostTime);
      } else if (this.startedAt !== null) {
        this.elapsedMs = performance.now() - this.startedAt;
      }
    }, 16);
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) clearInterval(this.timerHandle);
    this.timerHandle = null;
    this.startedAt = null;
    this.solveStartedCubeTime = null;
    this.solveStartedEstimatedHostTime = null;
  }

  private stopDemoPlayback(): void {
    if (this.demoPlaybackHandle !== null) clearInterval(this.demoPlaybackHandle);
    this.demoPlaying = false;
    this.demoPlaybackHandle = null;
  }
}

const trainerGlobal = globalThis as typeof globalThis & {
  __cfopTrainerStore?: TrainerStore;
  __cfopTrainerStoreSchema?: number;
};
const TRAINER_STORE_SCHEMA = 5;

// HMR normally keeps the BLE session alive by reusing the store. When a code
// update adds reactive fields or subscriptions, however, an old instance
// cannot be upgraded safely in place. Reload once for that schema change so
// the native connection is closed cleanly and auto-reconnect builds the full
// current event pipeline.
if (
  trainerGlobal.__cfopTrainerStore &&
  trainerGlobal.__cfopTrainerStoreSchema !== TRAINER_STORE_SCHEMA &&
  typeof window !== "undefined"
) {
  trainerGlobal.__cfopTrainerStoreSchema = TRAINER_STORE_SCHEMA;
  window.setTimeout(() => window.location.reload(), 0);
}

if (trainerGlobal.__cfopTrainerStore) {
  Object.setPrototypeOf(trainerGlobal.__cfopTrainerStore, TrainerStore.prototype);
  trainerGlobal.__cfopTrainerStore.refreshGanV4RuntimePoseContract();
}
trainerGlobal.__cfopTrainerStoreSchema = TRAINER_STORE_SCHEMA;
export const trainer = trainerGlobal.__cfopTrainerStore ??= new TrainerStore();
