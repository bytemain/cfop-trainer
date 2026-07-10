import type { BleConnection, DiscoveredDevice } from "$lib/ble/types";

export type GanProtocolVersion = "v1" | "v2" | "v3" | "v4";

export interface CubeMoveEvent {
  move: string;
  sequence: number;
  cubeTimestamp?: number;
  receivedAt: number;
  protocol: GanProtocolVersion;
}

export interface CubeSnapshot {
  facelets: string;
  sequence?: number;
  receivedAt: number;
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
  orientation(listener: (event: CubeOrientationEvent) => void): Promise<() => Promise<void>>;
  requestSnapshot(): Promise<CubeSnapshot>;
  batteryLevel(): Promise<number | undefined>;
  disconnect(): Promise<void>;
}

export interface GanProtocolAdapter {
  readonly version: GanProtocolVersion;
  match(device: DiscoveredDevice): GanProtocolMatch | null;
  open(connection: BleConnection): Promise<SmartCubeSession>;
}
