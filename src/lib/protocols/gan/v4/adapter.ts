import type { BleConnection, DiscoveredDevice } from "$lib/ble/types";
import type {
  CubeMoveEvent,
  CubeSnapshot,
  GanProtocolAdapter,
  GanProtocolMatch,
  SmartCubeSession,
} from "../types";
import { deriveGanV2CipherMaterial, extractGanHardwareAddress, GanV2Cipher } from "./crypto";
import {
  createGanV4Request,
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
  private pendingSnapshots: PendingResponse<CubeSnapshot>[] = [];
  private pendingBattery: PendingResponse<number | undefined>[] = [];
  private unsubscribe: (() => Promise<void>) | null = null;
  private closed = false;

  constructor(
    readonly device: DiscoveredDevice,
    private readonly connection: BleConnection,
    private readonly cipher: GanV2Cipher,
  ) {}

  async start(): Promise<void> {
    this.unsubscribe = await this.connection.subscribe(GAN_V4_SERVICE, GAN_V4_READ, (data) => {
      this.handleNotification(data);
    });
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

  requestSnapshot(): Promise<CubeSnapshot> {
    return this.requestResponse(
      this.pendingSnapshots,
      createGanV4Request("snapshot"),
      "Timed out while waiting for GAN V4 cube state",
    );
  }

  batteryLevel(): Promise<number | undefined> {
    return this.requestResponse(
      this.pendingBattery,
      createGanV4Request("battery"),
      "Timed out while waiting for GAN V4 battery level",
    );
  }

  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.unsubscribe?.().catch(() => undefined);
    this.rejectPending(new Error("GAN cube disconnected"));
    await this.connection.disconnect();
  }

  private requestResponse<T>(
    queue: PendingResponse<T>[],
    request: Uint8Array,
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
          reject(new Error(timeoutMessage));
        }, 4_000),
      };
      queue.push(pending);
      void this.send(request).catch((error) => {
        clearTimeout(pending.timer);
        const index = queue.indexOf(pending);
        if (index >= 0) queue.splice(index, 1);
        reject(error);
      });
    });
  }

  private async send(request: Uint8Array): Promise<void> {
    await this.connection.write(GAN_V4_SERVICE, GAN_V4_WRITE, this.cipher.encode(request), true);
  }

  private handleNotification(encrypted: Uint8Array): void {
    try {
      this.dispatch(parseGanV4Packet(this.cipher.decode(encrypted)));
    } catch {
      // An undecodable packet is ignored. The request timeout or a following
      // sequence gap turns this into an explicit degraded session upstream.
    }
  }

  private dispatch(packet: GanV4Packet): void {
    if (packet.type === "snapshot") {
      const snapshot: CubeSnapshot = {
        facelets: packet.facelets,
        sequence: packet.sequence,
        receivedAt: Date.now(),
      };
      this.resolveNext(this.pendingSnapshots, snapshot);
      return;
    }

    if (packet.type === "battery") {
      this.resolveNext(this.pendingBattery, packet.level);
      return;
    }

    if (packet.type !== "move") return;

    const event: CubeMoveEvent = {
      move: packet.move,
      sequence: packet.sequence,
      cubeTimestamp: packet.cubeTimestamp,
      receivedAt: Date.now(),
      protocol: "v4",
    };
    for (const listener of this.listeners) listener(event);
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
    const hardwareAddress = extractGanHardwareAddress(connection.device.manufacturerData);
    if (!hardwareAddress) {
      throw new Error(
        "未收到 GAN 加密所需的 manufacturer data；请转动魔方保持唤醒，然后重新扫描。",
      );
    }

    const session = new GanV4Session(
      connection.device,
      connection,
      new GanV2Cipher(deriveGanV2CipherMaterial(hardwareAddress)),
    );
    await session.start();
    return session;
  }
}
