import { createActor } from "xstate";
import type { BleConnection, CubeConnectionState, DiscoveredDevice } from "$lib/ble/types";
import { TauriBlecTransport } from "$lib/ble/tauriBlecTransport";
import {
  applyMove,
  applyMoves,
  cloneCube,
  createSolvedCube,
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
import { reconstructSolve } from "$lib/analysis/solveReconstruction";
import { solveCrossOptimal } from "$lib/analysis/crossSolver";

const SCRAMBLE_FACES = ["U", "R", "F", "D", "L", "B"] as const;
const SCRAMBLE_SUFFIXES = ["", "'", "2"] as const;
const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const GLOBAL_CUBE_PROFILE_KEY = "cfop-trainer:cube-profile:default";

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
  firmwareVersion = $state("unknown");
  hardwareVersion = $state("unknown");
  demoPlaying = $state(false);
  faceColors = $state({ ...SOLVED_COLORS });
  stickerPalette = $state<StickerPalette>({ ...BRIGHT_STICKER_PALETTE });
  deviceCalibration = $state<DeviceCalibration>({ ...DEFAULT_DEVICE_CALIBRATION });
  sessionAnchor = $state<SessionAnchor | null>(null);
  viewPreference = $state<ViewPreference>({ ...DEFAULT_VIEW_PREFERENCE });
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

  private actor = createActor(trainingMachine);
  private startedAt: number | null = null;
  private completedMs = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private demoPlaybackHandle: ReturnType<typeof setInterval> | null = null;
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

  async scanRealDevices(): Promise<void> {
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
      this.connection = this.devices.length > 0 ? "idle" : "disconnected";
      this.connectionMessage =
        this.devices.length > 0
          ? `发现 ${this.devices.length} 个候选设备。请选择 GAN16 ui 建立加密连接。`
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
      const adapter = ganProtocolAdapterFor(device);
      if (!adapter) {
        safeLogger.warn("trainer", "protocol-unsupported", { name: device.name });
        this.connection = "unsupported";
        this.connectionMessage = `${device.name} 暂未匹配到已实现的 GAN 协议。`;
        return;
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
      this.lastCubeSequence = snapshot.sequence;
      this.cubeSequence = snapshot.sequence ?? null;
      this.resetSolveTimeline();
      this.initialSynchronizing = false;
      const queuedMoves = this.initialMoveQueue;
      this.initialMoveQueue = [];
      for (const queuedMove of queuedMoves) this.handleRealMove(queuedMove);
      this.connectedDeviceName = device.name;
      this.connection = "ready";
      this.connectionMessage = `${device.name} 已连接。`;
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

      void this.session.batteryLevel().then((level) => {
        this.battery = level ?? null;
      }).catch(() => undefined);
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
        this.markTimelineDiscontinuity("manual-or-protocol-resync", snapshot.sequence ?? null);
        this.cube = cubeStateFromFacelets(snapshot.facelets, this.faceColors);
        this.lastCubeSequence = snapshot.sequence;
        this.cubeSequence = snapshot.sequence ?? null;
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

  async resetAndSyncCubeState(): Promise<void> {
    if (!this.session || !this.connectedDeviceName) {
      this.connectionMessage = "请先连接实体魔方，再重置并同步状态。";
      return;
    }

    this.stopTimer();
    this.stopDemoPlayback();
    this.connection = "synchronizing";
    this.connectionMessage = "正在读取实体魔方的完整状态…";
    safeLogger.info("trainer", "manual-state-sync-start", {
      name: this.connectedDeviceName,
    });

    try {
      const snapshot = await withTimeout(
        this.session.requestSnapshot(),
        12_000,
        "读取完整魔方状态超时",
      );
      this.cube = cubeStateFromFacelets(snapshot.facelets, this.faceColors);
      this.lastCubeSequence = snapshot.sequence;
      this.cubeSequence = snapshot.sequence ?? null;
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
      this.connection = "ready";
      this.connectionMessage = `${this.connectedDeviceName} 的状态已重新同步。`;
      safeLogger.info("trainer", "manual-state-sync-complete", {
        name: this.connectedDeviceName,
        sequence: snapshot.sequence ?? null,
      });
    } catch (error) {
      this.connection = "degraded";
      this.connectionMessage = `状态同步失败：${error instanceof Error ? error.message : String(error)}`;
      safeLogger.warn("trainer", "manual-state-sync-failed", {
        name: this.connectedDeviceName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
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

  setGyroEnabled(enabled: boolean): void {
    this.deviceCalibration = { ...this.deviceCalibration, enabled };
    this.poseSession.configure(this.deviceCalibration, this.viewPreference);
    this.poseHealth = this.poseSession.currentHealth();
    this.persistDevicePreferences();
  }

  zeroGyro(): void {
    if (!this.gyroQuaternion) return;
    this.poseSession.manuallyAnchor(this.gyroQuaternion);
    this.sessionAnchor = this.poseSession.currentAnchor();
    this.poseHealth = this.poseSession.currentHealth();
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
      this.poseSession.bootstrap(derivedCalibration.zero);
      this.sessionAnchor = this.poseSession.currentAnchor();
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
      gyroMappingApplied: Boolean(derivedCalibration?.valid),
      gyroMappingConfidence: derivedCalibration?.confidence,
    });
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
      if (gap === 0) return;
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

    if (this.sessionState === "scrambling" && this.currentScrambleMove === move) {
      this.scrambleIndex += 1;
      if (this.scrambleIndex === this.scramble.length) {
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
      this.lastCubeSequence = event.snapshot.sequence;
      this.cubeSequence = event.snapshot.sequence ?? null;
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
  }

  private handleSignalFrame(event: CubeSignalFrameEvent): void {
    // The decoded frame lives only in this short-lived in-memory handoff. It is
    // never sent to safeLogger or persisted by the TrainerStore.
    this.lastSignalFrame = {
      ...event,
      bytes: event.bytes.slice(),
    };
    this.signalFrameSerial += 1;
  }

  private loadDevicePreferences(deviceId: string): void {
    // Color/view defaults may be global, but a sensor mounting solution must
    // never leak from one physical cube profile into another.
    this.deviceCalibration = { ...DEFAULT_DEVICE_CALIBRATION };
    this.viewPreference = { ...DEFAULT_VIEW_PREFERENCE };
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
        faceColors?: Record<Face, StickerColor>;
        crossColor?: StickerColor;
        stickerPalette?: Partial<StickerPalette>;
        gyroCalibration?: GyroCalibration;
        deviceCalibration?: DeviceCalibration;
        viewPreference?: ViewPreference;
      };
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
          relativeOrder: profile.gyroCalibration.relativeOrder ?? "reference-current-inverse",
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
      this.sessionAnchor = this.poseSession.currentAnchor();
      this.poseHealth = this.poseSession.currentHealth();
    } catch {
      // Invalid local calibration is ignored and can be recreated in Settings.
    }
  }

  private persistDevicePreferences(): void {
    if (typeof localStorage === "undefined") return;
    const value = JSON.stringify({
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
const TRAINER_STORE_SCHEMA = 4;

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
}
trainerGlobal.__cfopTrainerStoreSchema = TRAINER_STORE_SCHEMA;
export const trainer = trainerGlobal.__cfopTrainerStore ??= new TrainerStore();
