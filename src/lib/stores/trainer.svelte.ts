import { createActor } from "xstate";
import type { CubeConnectionState, DiscoveredDevice } from "$lib/ble/types";
import { TauriBlecTransport } from "$lib/ble/tauriBlecTransport";
import {
  applyMove,
  createSolvedCube,
  derivePhase,
  derivePhaseFacts,
  invertAlgorithm,
  isSolved,
  type CubeState,
} from "$lib/cube/cube";
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

  constructor() {
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
          ? `发现 ${this.devices.length} 个候选设备。协议连接将在兼容矩阵确认后启用。`
          : "未发现 GAN 候选设备。请确认魔方已唤醒并靠近本机。";
    } catch (error) {
      this.connection = "disconnected";
      this.connectionMessage = `扫描失败：${error instanceof Error ? error.message : String(error)}`;
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

  resync(): void {
    this.connection = "synchronizing";
    this.cube = createSolvedCube();
    this.scramble = [];
    this.scrambleIndex = 0;
    this.solveMoves = [];
    this.solveIndex = 0;
    this.elapsedMs = 0;
    this.lastMove = null;
    this.send({ type: "RESYNC" });
    this.connection = "ready";
    this.connectionMessage = "已通过完整 snapshot 恢复到演示 solved 状态。";
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
