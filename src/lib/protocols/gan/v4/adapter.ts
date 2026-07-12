import type { BleConnection, DiscoveredDevice } from "$lib/ble/types";
import type {
  CubeMoveEvent,
  CubeContinuityEvent,
  CubeOrientationEvent,
  CubeSignalFrameEvent,
  CubeSnapshot,
  CubeHardwareInfo,
  GanProtocolAdapter,
  GanProtocolMatch,
  SmartCubeSession,
} from "../types";
import { safeLogger } from "$lib/logging/safeLogger";
import {
  createGanV2CipherCandidates,
  GanV2Cipher,
  selectGanV2Cipher,
  type GanCipherCandidate,
} from "./crypto";
import {
  createGanV4Request,
  createGanV4HistoryRequest,
  parseGanV4Packet,
  type GanV4Packet,
} from "./parser";

export const GAN_V4_SERVICE = "00000010-0000-fff7-fff6-fff5fff4fff0";
export const GAN_V4_READ = "0000fff6-0000-1000-8000-00805f9b34fb";
export const GAN_V4_WRITE = "0000fff5-0000-1000-8000-00805f9b34fb";

interface PendingResponse<T> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

class GanV4Session implements SmartCubeSession {
  readonly protocol = "v4" as const;
  private listeners = new Set<(event: CubeMoveEvent) => void>();
  private continuityListeners = new Set<(event: CubeContinuityEvent) => void>();
  private orientationListeners = new Set<(event: CubeOrientationEvent) => void>();
  private signalListeners = new Set<(event: CubeSignalFrameEvent) => void>();
  private pendingSnapshots: PendingResponse<CubeSnapshot>[] = [];
  private pendingBattery: PendingResponse<number | undefined>[] = [];
  private unsubscribe: (() => Promise<void>) | null = null;
  private closed = false;
  private notifications = 0;
  private parseFailures = 0;
  private cipher: GanV2Cipher | null = null;
  private calibrationPackets: Uint8Array[] = [];
  private moveBuffer = new Map<number, CubeMoveEvent>();
  private lastEmittedSequence: number | null = null;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private historyAttempts = 0;
  private historyTarget: number | null = null;
  private recoveryInFlight = false;
  private hardware: CubeHardwareInfo = {};

  constructor(
    readonly device: DiscoveredDevice,
    private readonly connection: BleConnection,
    private readonly cipherCandidates: GanCipherCandidate[],
  ) {}

  async start(): Promise<void> {
    safeLogger.info("gan-v4", "session-start", { name: this.device.name });
    this.unsubscribe = await this.connection.subscribe(GAN_V4_SERVICE, GAN_V4_READ, (data) => {
      if (!this.cipher) {
        if (data.length >= 16 && this.calibrationPackets.length < 64) {
          this.calibrationPackets.push(data.slice());
        }
        return;
      }
      this.handleNotification(data);
    });
    safeLogger.info("gan-v4", "session-subscribed", { name: this.device.name });
    await this.calibrateCipher();
  }

  initialSnapshot(): Promise<CubeSnapshot> {
    return this.requestSnapshot();
  }

  moves(listener: (event: CubeMoveEvent) => void): Promise<() => Promise<void>> {
    this.listeners.add(listener);
    return Promise.resolve(async () => {
      this.listeners.delete(listener);
    });
  }

  continuity(listener: (event: CubeContinuityEvent) => void): Promise<() => Promise<void>> {
    this.continuityListeners.add(listener);
    return Promise.resolve(async () => {
      this.continuityListeners.delete(listener);
    });
  }

  orientation(listener: (event: CubeOrientationEvent) => void): Promise<() => Promise<void>> {
    this.orientationListeners.add(listener);
    return Promise.resolve(async () => {
      this.orientationListeners.delete(listener);
    });
  }

  signals(listener: (event: CubeSignalFrameEvent) => void): Promise<() => Promise<void>> {
    this.signalListeners.add(listener);
    return Promise.resolve(async () => {
      this.signalListeners.delete(listener);
    });
  }

  requestSnapshot(): Promise<CubeSnapshot> {
    return this.requestResponse(
      this.pendingSnapshots,
      createGanV4Request("snapshot"),
      "snapshot",
      "Timed out while waiting for GAN V4 cube state",
    );
  }

  batteryLevel(): Promise<number | undefined> {
    return this.requestResponse(
      this.pendingBattery,
      createGanV4Request("battery"),
      "battery",
      "Timed out while waiting for GAN V4 battery level",
    );
  }

  async hardwareInfo(): Promise<CubeHardwareInfo | undefined> {
    await this.send(createGanV4Request("hardware"));
    await new Promise((resolve) => setTimeout(resolve, 650));
    return Object.keys(this.hardware).length > 0 ? { ...this.hardware } : undefined;
  }

  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    safeLogger.info("gan-v4", "session-disconnect", { name: this.device.name });
    await this.unsubscribe?.().catch(() => undefined);
    this.rejectPending(new Error("GAN cube disconnected"));
    if (this.historyTimer) clearTimeout(this.historyTimer);
    await this.connection.disconnect();
  }

  private requestResponse<T>(
    queue: PendingResponse<T>[],
    request: Uint8Array,
    requestKind: "snapshot" | "battery",
    timeoutMessage: string,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("GAN cube session is closed"));

    return new Promise<T>((resolve, reject) => {
      const pending: PendingResponse<T> = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = queue.indexOf(pending);
          if (index >= 0) queue.splice(index, 1);
          safeLogger.warn("gan-v4", "request-timeout", {
            requestKind,
            notifications: this.notifications,
            parseFailures: this.parseFailures,
          });
          reject(new Error(timeoutMessage));
        }, 4_000),
      };
      queue.push(pending);
      safeLogger.info("gan-v4", "request-send", { requestKind });
      void this.send(request)
        .then(() => this.pollReadFallback(queue, pending, requestKind))
        .catch((error) => {
          clearTimeout(pending.timer);
          const index = queue.indexOf(pending);
          if (index >= 0) queue.splice(index, 1);
          safeLogger.error("gan-v4", "request-write-failed", {
            requestKind,
            reason: error instanceof Error ? error.message : String(error),
          });
          reject(error);
        });
    });
  }

  private async pollReadFallback<T>(
    queue: PendingResponse<T>[],
    pending: PendingResponse<T>,
    requestKind: "snapshot" | "battery",
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (let attempt = 1; attempt <= 7 && queue.includes(pending) && !this.closed; attempt += 1) {
      try {
        const encrypted = await this.connection.read(GAN_V4_SERVICE, GAN_V4_READ);
        safeLogger.debug("gan-v4", "read-fallback", {
          requestKind,
          attempt,
          bytes: encrypted.length,
        });
        this.handleNotification(encrypted);
      } catch (error) {
        if (attempt === 1 || attempt === 7) {
          safeLogger.warn("gan-v4", "read-fallback-failed", {
            requestKind,
            attempt,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (queue.includes(pending)) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  }

  private async send(request: Uint8Array): Promise<void> {
    if (!this.cipher) throw new Error("GAN V4 cipher calibration has not completed");
    await this.connection.write(GAN_V4_SERVICE, GAN_V4_WRITE, this.cipher.encode(request), true);
  }

  private handleNotification(encrypted: Uint8Array): void {
    this.notifications += 1;
    try {
      if (!this.cipher) return;
      const decoded = this.cipher.decode(encrypted);
      const packet = parseGanV4Packet(decoded);
      const packetType = packet.type === "move-history" ? "move-history" : packet.type;
      const signal: CubeSignalFrameEvent = {
        bytes: decoded.slice(),
        layer: "decrypted",
        packetType,
        receivedAt: Date.now(),
        protocol: "v4",
      };
      for (const listener of this.signalListeners) listener(signal);
      if (packet.type !== "unknown" || this.notifications <= 3 || this.notifications % 100 === 0) {
        safeLogger.debug("gan-v4", "packet-parsed", {
          packetType: packet.type,
          notifications: this.notifications,
          mode: packet.type === "unknown" ? packet.mode : undefined,
        });
      }
      this.dispatch(packet);
    } catch (error) {
      this.parseFailures += 1;
      if (this.parseFailures <= 3 || this.parseFailures % 100 === 0) {
        safeLogger.warn("gan-v4", "packet-rejected", {
          notifications: this.notifications,
          parseFailures: this.parseFailures,
          bytes: encrypted.length,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      // An undecodable packet is ignored. The request timeout or a following
      // sequence gap turns this into an explicit degraded session upstream.
    }
  }

  private dispatch(packet: GanV4Packet): void {
    if (packet.type === "snapshot") {
      const requested = this.pendingSnapshots.length > 0;
      const establishesInitialBaseline = requested && this.lastEmittedSequence === null;
      safeLogger.info("gan-v4", "snapshot-received", {
        sequence: packet.sequence,
        requested,
        establishesInitialBaseline,
      });
      const snapshot: CubeSnapshot = {
        facelets: packet.facelets,
        sequence: packet.sequence,
        receivedAt: Date.now(),
      };
      // GAN16ui broadcasts 0xED state packets periodically, and some firmware
      // reports move counter 0 in those packets. Only the explicitly requested
      // initial snapshot owns the first move baseline. Later state packets may
      // refresh facelets, but must never rewind the live move stream.
      if (establishesInitialBaseline) this.establishMoveBaseline(snapshot.sequence ?? null);
      this.resolveNext(this.pendingSnapshots, snapshot);
      return;
    }

    if (packet.type === "battery") {
      safeLogger.info("gan-v4", "battery-received", { level: packet.level });
      this.resolveNext(this.pendingBattery, packet.level);
      return;
    }

    if (packet.type === "gyro") {
      const event: CubeOrientationEvent = {
        quaternion: packet.quaternion,
        velocity: packet.velocity,
        receivedAt: Date.now(),
        protocol: "v4",
      };
      for (const listener of this.orientationListeners) listener(event);
      return;
    }

    if (packet.type === "hardware") {
      if (packet.mode === 0xfc && packet.value) this.hardware.hardwareName = packet.value;
      if (packet.mode === 0xfd && packet.value) this.hardware.softwareVersion = packet.value;
      if (packet.mode === 0xfe && packet.value) this.hardware.hardwareVersion = packet.value;
      return;
    }

    if (packet.type === "move-history") {
      this.handleMoveHistory(packet);
      return;
    }

    if (packet.type !== "move") return;

    safeLogger.debug("gan-v4", "move-received", {
      move: packet.move,
      sequence: packet.sequence,
    });

    const event: CubeMoveEvent = {
      move: packet.move,
      sequence: packet.sequence,
      cubeTimestamp: packet.cubeTimestamp,
      receivedAt: Date.now(),
      protocol: "v4",
      source: "live",
    };
    this.enqueueMove(event);
  }

  private establishMoveBaseline(sequence: number | null): void {
    if (sequence === null) return;
    this.lastEmittedSequence = sequence;
    for (const bufferedSequence of this.moveBuffer.keys()) {
      const distance = (bufferedSequence - sequence) & 0xffff;
      if (distance === 0 || distance >= 0x8000) this.moveBuffer.delete(bufferedSequence);
    }
    this.drainMoveBuffer();
  }

  private enqueueMove(event: CubeMoveEvent): void {
    if (this.lastEmittedSequence !== null) {
      const distance = (event.sequence - this.lastEmittedSequence) & 0xffff;
      if (distance === 0 || distance >= 0x8000) return;
    }
    if (!this.moveBuffer.has(event.sequence)) this.moveBuffer.set(event.sequence, event);
    this.drainMoveBuffer();
  }

  private drainMoveBuffer(): void {
    if (this.lastEmittedSequence === null) return;
    let cursor = this.lastEmittedSequence;
    let emitted = 0;
    while (true) {
      const nextSequence: number = (cursor + 1) & 0xffff;
      const next = this.moveBuffer.get(nextSequence);
      if (!next) break;
      this.moveBuffer.delete(nextSequence);
      cursor = nextSequence;
      this.lastEmittedSequence = cursor;
      emitted += 1;
      for (const listener of this.listeners) listener(next);
    }

    if (emitted > 0 && this.recoveryInFlight && this.historyTarget !== null) {
      const remaining = (this.historyTarget - cursor) & 0xffff;
      if (remaining === 0 || remaining >= 0x8000) {
        this.finishHistoryRecovery(emitted);
      }
    }

    const head = this.nearestBufferedSequence();
    if (head !== null && ((head - cursor) & 0xffff) > 1) {
      void this.requestMissingMoves(head);
    }
  }

  private nearestBufferedSequence(): number | null {
    if (this.lastEmittedSequence === null || this.moveBuffer.size === 0) return null;
    return [...this.moveBuffer.keys()].sort((left, right) =>
      ((left - this.lastEmittedSequence!) & 0xffff) -
      ((right - this.lastEmittedSequence!) & 0xffff)
    )[0] ?? null;
  }

  private async requestMissingMoves(targetSequence: number): Promise<void> {
    if (this.closed || this.lastEmittedSequence === null) return;
    if (this.recoveryInFlight && this.historyTarget === targetSequence) return;
    if (this.recoveryInFlight) return;

    this.recoveryInFlight = true;
    this.historyTarget = targetSequence;
    this.historyAttempts = 0;
    this.emitContinuity({
      type: "history-recovery-started",
      previousSequence: this.lastEmittedSequence,
      targetSequence,
      receivedAt: Date.now(),
    });
    await this.sendHistoryAttempt();
  }

  private async sendHistoryAttempt(): Promise<void> {
    if (this.lastEmittedSequence === null || this.historyTarget === null || this.closed) return;
    this.historyAttempts += 1;
    const missingWindow = (this.historyTarget - this.lastEmittedSequence) & 0xffff;
    try {
      await this.send(createGanV4HistoryRequest(this.historyTarget & 0xff, missingWindow));
    } catch (error) {
      safeLogger.warn("gan-v4", "history-request-write-failed", {
        attempt: this.historyAttempts,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => void this.onHistoryTimeout(), 900);
  }

  private async onHistoryTimeout(): Promise<void> {
    this.historyTimer = null;
    if (!this.recoveryInFlight || this.historyTarget === null || this.lastEmittedSequence === null) return;
    if (this.historyAttempts < 3) {
      await this.sendHistoryAttempt();
      return;
    }

    const previousSequence = this.lastEmittedSequence;
    const targetSequence = this.historyTarget;
    safeLogger.warn("gan-v4", "history-recovery-fallback", {
      previousSequence,
      targetSequence,
      attempts: this.historyAttempts,
    });
    this.resetHistoryRecovery();
    try {
      const snapshot = await this.requestSnapshot();
      this.moveBuffer.clear();
      const snapshotBaseline = snapshot.sequence === 0 && targetSequence !== 0
        ? targetSequence
        : snapshot.sequence ?? targetSequence;
      this.establishMoveBaseline(snapshotBaseline);
      this.emitContinuity({
        type: "discontinuity",
        previousSequence,
        targetSequence,
        reason: "move-history-timeout",
        snapshot,
        receivedAt: Date.now(),
      });
    } catch (error) {
      this.emitContinuity({
        type: "discontinuity",
        previousSequence,
        targetSequence,
        reason: `move-history-and-snapshot-failed: ${error instanceof Error ? error.message : String(error)}`,
        receivedAt: Date.now(),
      });
    }
  }

  private handleMoveHistory(packet: Extract<GanV4Packet, { type: "move-history" }>): void {
    if (!this.recoveryInFlight || this.historyTarget === null) return;
    if (this.historyTimer) {
      clearTimeout(this.historyTimer);
      this.historyTimer = null;
    }
    for (const recovered of packet.moves) {
      const sequence = this.expandHistorySequence(recovered.sequence, this.historyTarget);
      if (this.moveBuffer.has(sequence)) continue;
      this.moveBuffer.set(sequence, {
        move: recovered.move,
        sequence,
        receivedAt: Date.now(),
        protocol: "v4",
        source: "history",
      });
    }
    this.drainMoveBuffer();
    if (this.recoveryInFlight) void this.sendHistoryAttempt();
  }

  private expandHistorySequence(lowByte: number, reference: number): number {
    const base = reference & 0xff00;
    const candidates = [base | lowByte, ((base - 0x100) | lowByte) & 0xffff, ((base + 0x100) | lowByte) & 0xffff];
    return candidates.sort((left, right) => {
      const leftDistance = Math.min((left - reference) & 0xffff, (reference - left) & 0xffff);
      const rightDistance = Math.min((right - reference) & 0xffff, (reference - right) & 0xffff);
      return leftDistance - rightDistance;
    })[0];
  }

  private finishHistoryRecovery(recoveredMoves: number): void {
    if (this.lastEmittedSequence === null || this.historyTarget === null) return;
    const targetSequence = this.historyTarget;
    this.emitContinuity({
      type: "history-recovered",
      previousSequence: this.lastEmittedSequence,
      targetSequence,
      recoveredMoves,
      receivedAt: Date.now(),
    });
    this.resetHistoryRecovery();
  }

  private resetHistoryRecovery(): void {
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.recoveryInFlight = false;
    this.historyTarget = null;
    this.historyAttempts = 0;
  }

  private emitContinuity(event: CubeContinuityEvent): void {
    for (const listener of this.continuityListeners) listener(event);
  }

  private resolveNext<T>(queue: PendingResponse<T>[], value: T): void {
    const pending = queue.shift();
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(value);
  }

  private rejectPending(error: Error): void {
    for (const queue of [this.pendingSnapshots, this.pendingBattery]) {
      for (const pending of queue) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      queue.length = 0;
    }
  }

  private async calibrateCipher(): Promise<void> {
    // A real GAN16 ui starts emitting encrypted telemetry immediately. Give
    // the stream a short chance to prove the correct manufacturer-data layout;
    // silent fixtures and quieter GAN variants fall back to the legacy layout.
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (this.calibrationPackets.length > 0) {
      const deadline = Date.now() + 1_400;
      while (this.calibrationPackets.length < 16 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }

    const selection = selectGanV2Cipher(this.cipherCandidates, this.calibrationPackets);
    this.cipher = selection.cipher;
    safeLogger.info("gan-v4", "cipher-calibrated", {
      candidateCount: selection.candidateCount,
      sampleCount: selection.sampleCount,
      semanticScore: selection.semanticScore,
      credible: selection.credible,
    });
    this.calibrationPackets = [];
  }
}

export class GanV4Protocol implements GanProtocolAdapter {
  readonly version = "v4" as const;

  match(device: DiscoveredDevice): GanProtocolMatch | null {
    const services = device.serviceUuids.map((uuid) => uuid.toLowerCase());
    if (services.includes(GAN_V4_SERVICE)) {
      return { protocol: "v4", confidence: 1, reason: "GAN V4 service UUID advertised" };
    }
    if (device.name.toUpperCase().startsWith("GAN16UI")) {
      return { protocol: "v4", confidence: 0.95, reason: "GAN16 ui uses the GAN V4 service" };
    }
    return null;
  }

  async open(connection: BleConnection): Promise<SmartCubeSession> {
    safeLogger.info("gan-v4", "open-start", { name: connection.device.name });
    const cipherCandidates = createGanV2CipherCandidates(connection.device.manufacturerData);
    if (cipherCandidates.length === 0) {
      safeLogger.error("gan-v4", "cipher-material-missing", { name: connection.device.name });
      throw new Error(
        "未收到 GAN 加密所需的 manufacturer data；请转动魔方保持唤醒，然后重新扫描。",
      );
    }

    const session = new GanV4Session(connection.device, connection, cipherCandidates);
    safeLogger.info("gan-v4", "cipher-ready", {
      name: connection.device.name,
      manufacturerDataAvailable: true,
      candidateCount: cipherCandidates.length,
    });
    await session.start();
    return session;
  }
}
