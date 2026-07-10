import { createActor } from "xstate";
import type { BleConnection, CubeConnectionState, DiscoveredDevice } from "$lib/ble/types";
import { TauriBlecTransport } from "$lib/ble/tauriBlecTransport";
import {
  applyMove,
  createSolvedCube,
  cubeStateFromFacelets,
  derivePhase,
  derivePhaseFacts,
  invertAlgorithm,
  isSolved,
  normalizeMove,
  type CubeState,
} from "$lib/cube/cube";
import { ganProtocolAdapterFor, registerBuiltInGanProtocols } from "$lib/protocols/gan";
import type { CubeMoveEvent, SmartCubeSession } from "$lib/protocols/gan/types";
import { trainingMachine, type TrainingMachineEvent } from "$lib/sessions/trainingMachine";

const DEMO_SCRAMBLE = ["R", "U", "R'", "U'", "F2", "D", "L2", "B'"];

export const CONNECTION_LABELS: Record<CubeConnectionState, string> = {
  "bluetooth-unavailable": "蓝牙不可用",
  "permission-required": "需要蓝牙权限",
  idle: "未连接",
  scanning: "正在扫描",
  connecting: "正在连接",
  "discovering-services": "正在发现服务",
  authenticating: "正在识别协议",
  synchronizing: "正在同步状态",
  ready: "已连接并同步",
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
  connectedDeviceName = $state<string | null>(null);
  battery = $state<number | null>(null);

  phase = $derived(derivePhase(this.cube));
  facts = $derived(derivePhaseFacts(this.cube));
  currentScrambleMove = $derived(this.scramble[this.scrambleIndex] ?? null);
  currentSolveMove = $derived(this.solveMoves[this.solveIndex] ?? null);
  scrambleProgress = $derived(
    this.scramble.length === 0 ? 0 : this.scrambleIndex / this.scramble.length,
  );

  private actor = createActor(trainingMachine);
  private startedAt: number | null = null;
  private completedMs = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private session: SmartCubeSession | null = null;
  private unsubscribeMoves: (() => Promise<void>) | null = null;
  private lastCubeSequence: number | undefined;

  constructor() {
    registerBuiltInGanProtocols();
    this.actor.subscribe((snapshot) => {
      this.sessionState = String(snapshot.value);
    });
    this.actor.start();
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
    this.cube = createSolvedCube();
  }

  async scanRealDevices(): Promise<void> {
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

      this.devices = await transport.scan({ timeoutMs: 4_000, namePrefixes: ["GAN"] });
      this.connection = this.devices.length > 0 ? "idle" : "disconnected";
      this.connectionMessage =
        this.devices.length > 0
          ? `发现 ${this.devices.length} 个候选设备。请选择 GAN16 ui 建立加密连接。`
          : "未发现 GAN 候选设备。请确认魔方已唤醒并靠近本机。";
    } catch (error) {
      this.connection = "disconnected";
      this.connectionMessage = `扫描失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async connectRealDevice(device: DiscoveredDevice): Promise<void> {
    let connection: BleConnection | null = null;
    this.connection = "connecting";
    this.connectionMessage = `正在连接 ${device.name}…`;

    try {
      await this.closeRealSession();
      const adapter = ganProtocolAdapterFor(device);
      if (!adapter) {
        this.connection = "unsupported";
        this.connectionMessage = `${device.name} 暂未匹配到已实现的 GAN 协议。`;
        return;
      }

      const transport = new TauriBlecTransport();
      connection = await transport.connect(device);
      this.connection = "authenticating";
      this.connectionMessage = `已识别 ${adapter.version.toUpperCase()}，正在建立加密会话…`;
      this.session = await adapter.open(connection);
      connection = null;

      this.connection = "synchronizing";
      this.connectionMessage = "正在读取完整 54 格状态和 move counter…";
      const snapshot = await this.session.initialSnapshot();
      this.cube = cubeStateFromFacelets(snapshot.facelets);
      this.lastCubeSequence = snapshot.sequence;
      this.unsubscribeMoves = await this.session.moves((event) => this.handleRealMove(event));
      this.connectedDeviceName = device.name;
      this.connection = "ready";
      this.connectionMessage = `${device.name} 已通过 GAN V4 加密协议同步。`;

      void this.session.batteryLevel().then((level) => {
        this.battery = level ?? null;
      }).catch(() => undefined);
    } catch (error) {
      await connection?.disconnect().catch(() => undefined);
      await this.closeRealSession();
      this.connection = "disconnected";
      this.connectionMessage = `连接失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  prepareDemoScramble(): void {
    if (this.connection !== "ready") return;
    this.stopTimer();
    this.cube = createSolvedCube();
    this.scramble = [...DEMO_SCRAMBLE];
    this.scrambleIndex = 0;
    this.solveMoves = [];
    this.solveIndex = 0;
    this.elapsedMs = 0;
    this.completedMs = 0;
    this.lastMove = null;
    this.eventCount = 0;
    this.hadDesync = false;
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
        this.cube = cubeStateFromFacelets(snapshot.facelets);
        this.lastCubeSequence = snapshot.sequence;
      } catch (error) {
        this.connection = "degraded";
        this.connectionMessage = `重同步失败：${error instanceof Error ? error.message : String(error)}`;
        return;
      }
    } else {
      this.cube = createSolvedCube();
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
      ? "已通过 GAN V4 完整 snapshot 恢复实时魔方状态。"
      : "已通过完整 snapshot 恢复到演示 solved 状态。";
  }

  reset(): void {
    this.stopTimer();
    this.cube = createSolvedCube();
    this.scramble = [];
    this.scrambleIndex = 0;
    this.solveMoves = [];
    this.solveIndex = 0;
    this.elapsedMs = 0;
    this.lastMove = null;
    this.eventCount = 0;
    this.hadDesync = false;
    this.send({ type: "RESET" });
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

  private applyDomainMove(move: string): void {
    this.cube = applyMove(this.cube, move);
    this.lastMove = move;
    this.eventCount += 1;
  }

  private handleRealMove(event: CubeMoveEvent): void {
    if (this.lastCubeSequence !== undefined) {
      const gap = (event.sequence - this.lastCubeSequence) & 0xffff;
      if (gap === 0) return;
      if (gap > 1 && gap < 0x8000) {
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
    const move = normalizeMove(event.move);
    this.applyDomainMove(move);

    if (this.sessionState === "scrambling" && this.currentScrambleMove === move) {
      this.scrambleIndex += 1;
      if (this.scrambleIndex === this.scramble.length) {
        this.solveMoves = invertAlgorithm(this.scramble);
        this.solveIndex = 0;
        this.send({ type: "SCRAMBLE_COMPLETE" });
      }
      return;
    }

    if (this.sessionState === "ready") {
      this.startedAt = performance.now();
      this.startTimer();
      this.send({ type: "FIRST_MOVE" });
    }

    if (this.sessionState === "running" && isSolved(this.cube)) {
      this.completedMs = this.startedAt === null ? 0 : performance.now() - this.startedAt;
      this.elapsedMs = this.completedMs;
      this.stopTimer();
      this.send({ type: "SOLVED" });
    }
  }

  private async closeRealSession(): Promise<void> {
    await this.unsubscribeMoves?.().catch(() => undefined);
    this.unsubscribeMoves = null;
    await this.session?.disconnect().catch(() => undefined);
    this.session = null;
    this.connectedDeviceName = null;
    this.battery = null;
    this.lastCubeSequence = undefined;
  }

  private startTimer(): void {
    if (this.timerHandle !== null) clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      if (this.startedAt !== null) this.elapsedMs = performance.now() - this.startedAt;
    }, 16);
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) clearInterval(this.timerHandle);
    this.timerHandle = null;
    this.startedAt = null;
  }
}

export const trainer = new TrainerStore();
