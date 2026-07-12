import type { BleConnection, DiscoveredDevice } from "$lib/ble/types";

export type GanProtocolVersion = "v1" | "v2" | "v3" | "v4";

export interface CubeMoveEvent {
  move: string;
  sequence: number;
  cubeTimestamp?: number;
  receivedAt: number;
  protocol: GanProtocolVersion;
  source?: "live" | "history";
}

export interface CubeContinuityEvent {
  type: "history-recovery-started" | "history-recovered" | "discontinuity";
  previousSequence: number;
  targetSequence: number;
  recoveredMoves?: number;
  reason?: string;
  snapshot?: CubeSnapshot;
  receivedAt: number;
}

export interface CubeSnapshot {
  facelets: string;
  sequence?: number;
  receivedAt: number;
}

export interface CubeHardwareInfo {
  hardwareName?: string;
  softwareVersion?: string;
  hardwareVersion?: string;
}

export interface CubeQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface CubeOrientationEvent {
  quaternion: CubeQuaternion;
  velocity?: { x: number; y: number; z: number };
  receivedAt: number;
  protocol: GanProtocolVersion;
}

export interface CubeSignalFrameEvent {
  bytes: Uint8Array;
  layer: "decrypted" | "encrypted";
  packetType: "gyro" | "move" | "move-history" | "snapshot" | "battery" | "hardware" | "unknown" | "invalid";
  receivedAt: number;
  protocol: GanProtocolVersion;
}

export interface GanProtocolMatch {
  protocol: GanProtocolVersion;
  confidence: number;
  reason: string;
}

export interface SmartCubeSession {
  readonly device: DiscoveredDevice;
  readonly protocol: GanProtocolVersion;
  initialSnapshot(): Promise<CubeSnapshot>;
  moves(listener: (event: CubeMoveEvent) => void): Promise<() => Promise<void>>;
  continuity(listener: (event: CubeContinuityEvent) => void): Promise<() => Promise<void>>;
  orientation(listener: (event: CubeOrientationEvent) => void): Promise<() => Promise<void>>;
  signals(listener: (event: CubeSignalFrameEvent) => void): Promise<() => Promise<void>>;
  requestSnapshot(): Promise<CubeSnapshot>;
  writeSolvedState?(): Promise<CubeSnapshot>;
  batteryLevel(): Promise<number | undefined>;
  hardwareInfo(): Promise<CubeHardwareInfo | undefined>;
  disconnect(): Promise<void>;
}

export interface GanProtocolAdapter {
  readonly version: GanProtocolVersion;
  match(device: DiscoveredDevice): GanProtocolMatch | null;
  open(connection: BleConnection): Promise<SmartCubeSession>;
}
