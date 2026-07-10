export type CubeConnectionState =
  | "bluetooth-unavailable"
  | "permission-required"
  | "idle"
  | "scanning"
  | "connecting"
  | "discovering-services"
  | "authenticating"
  | "synchronizing"
  | "ready"
  | "degraded"
  | "reconnecting"
  | "disconnected"
  | "unsupported";

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi?: number;
  serviceUuids: string[];
  manufacturerData?: Record<number, number[]>;
}

export interface ScanOptions {
  timeoutMs?: number;
  namePrefixes?: string[];
}

export interface BleConnection {
  readonly device: DiscoveredDevice;
  disconnect(): Promise<void>;
  read(service: string, characteristic: string): Promise<Uint8Array>;
  write(
    service: string,
    characteristic: string,
    data: Uint8Array,
    withResponse?: boolean,
  ): Promise<void>;
  subscribe(
    service: string,
    characteristic: string,
    listener: (data: Uint8Array) => void,
  ): Promise<() => Promise<void>>;
}

export interface BleTransport {
  isAvailable(): Promise<boolean>;
  requestPermissions(): Promise<boolean>;
  scan(options?: ScanOptions): Promise<DiscoveredDevice[]>;
  connect(device: DiscoveredDevice): Promise<BleConnection>;
}

