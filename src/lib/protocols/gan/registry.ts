import type { DiscoveredDevice } from "$lib/ble/types";
import type { GanProtocolAdapter, GanProtocolMatch } from "./types";

const adapters: GanProtocolAdapter[] = [];

export function registerGanProtocol(adapter: GanProtocolAdapter): void {
  const existingIndex = adapters.findIndex((candidate) => candidate.version === adapter.version);
  if (existingIndex >= 0) adapters.splice(existingIndex, 1, adapter);
  else adapters.push(adapter);
}

export function detectGanProtocol(device: DiscoveredDevice): GanProtocolMatch | null {
  return adapters
    .map((adapter) => adapter.match(device))
    .filter((match): match is GanProtocolMatch => match !== null)
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export function registeredGanProtocols(): readonly GanProtocolAdapter[] {
  return adapters;
}

export function ganProtocolAdapterFor(device: DiscoveredDevice): GanProtocolAdapter | null {
  const match = detectGanProtocol(device);
  return match ? adapters.find((adapter) => adapter.version === match.protocol) ?? null : null;
}
