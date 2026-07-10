import {
  checkPermissions,
  connect,
  disconnect,
  getAdapterState,
  read,
  send,
  startScan,
  stopScan,
  subscribe,
  unsubscribe,
} from "@mnlphlp/plugin-blec";
import type {
  BleConnection,
  BleTransport,
  DiscoveredDevice,
  ScanOptions,
} from "./types";

export class TauriBlecTransport implements BleTransport {
  async isAvailable(): Promise<boolean> {
    return (await getAdapterState()) === "On";
  }

  requestPermissions(): Promise<boolean> {
    return checkPermissions(true);
  }

  async scan(options: ScanOptions = {}): Promise<DiscoveredDevice[]> {
    const timeoutMs = options.timeoutMs ?? 4_000;
    const prefixes = options.namePrefixes ?? ["GAN"];
    const found = new Map<string, DiscoveredDevice>();

    await startScan((devices) => {
      for (const device of devices) {
        if (!prefixes.some((prefix) => device.name?.toUpperCase().startsWith(prefix))) {
          continue;
        }

        found.set(device.address, {
          id: device.address,
          name: device.name || "Unknown BLE device",
          rssi: device.rssi,
          serviceUuids: device.services,
          manufacturerData: device.manufacturerData,
        });
      }
    }, timeoutMs);

    await stopScan().catch(() => undefined);
    return [...found.values()].sort((left, right) => (right.rssi ?? -999) - (left.rssi ?? -999));
  }

  async connect(device: DiscoveredDevice): Promise<BleConnection> {
    await connect(device.id, null);

    return {
      device,
      disconnect,
      async read(service, characteristic) {
        return new Uint8Array(await read(characteristic, service));
      },
      async write(service, characteristic, data, withResponse = true) {
        await send(
          characteristic,
          [...data],
          withResponse ? "withResponse" : "withoutResponse",
          service,
        );
      },
      async subscribe(service, characteristic, listener) {
        await subscribe(characteristic, service, (data) => listener(new Uint8Array(data)));
        return async () => unsubscribe(characteristic, service);
      },
    };
  }
}

