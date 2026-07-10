import {
  checkPermissions,
  connect,
  disconnect,
  getAdapterState,
  read,
  send,
  startScan,
  stopScan,
  unsubscribe,
} from "@mnlphlp/plugin-blec";
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  BleConnection,
  BleTransport,
  DiscoveredDevice,
  ScanOptions,
} from "./types";
import { safeLogger } from "$lib/logging/safeLogger";

interface NativeBleDevice {
  id: string;
  name: string;
  rssi?: number;
  serviceUuids: string[];
  manufacturerData?: Record<number, number[]>;
}

async function usesNativeMacBleBackend(): Promise<boolean> {
  return (await invoke<string>("ble_backend")) === "native-macos";
}

export class TauriBlecTransport implements BleTransport {
  async isAvailable(): Promise<boolean> {
    if (await usesNativeMacBleBackend()) {
      const available = await invoke<boolean>("native_ble_adapter_available");
      safeLogger.info("ble", "adapter-state", { state: available ? "On" : "Off", backend: "native-macos" });
      return available;
    }
    const state = await getAdapterState();
    safeLogger.info("ble", "adapter-state", { state });
    return state === "On";
  }

  async requestPermissions(): Promise<boolean> {
    if (await usesNativeMacBleBackend()) {
      // CoreBluetooth requests macOS Bluetooth permission when the native
      // manager is created; plugin-blec does not need to initialize a second
      // CBCentralManager just to repeat that check.
      safeLogger.info("ble", "permissions", { granted: true, backend: "native-macos" });
      return true;
    }
    const granted = await checkPermissions(true);
    safeLogger.info("ble", "permissions", { granted });
    return granted;
  }

  async scan(options: ScanOptions = {}): Promise<DiscoveredDevice[]> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const prefixes = options.namePrefixes ?? ["GAN"];

    if (await usesNativeMacBleBackend()) {
      safeLogger.info("ble", "scan-start", { timeoutMs, prefixes, backend: "native-macos" });
      const devices = await invoke<NativeBleDevice[]>("native_ble_scan", {
        timeoutMs,
        prefixes,
      });
      const result = devices.map((device) => ({
        id: device.id,
        name: device.name,
        rssi: device.rssi,
        serviceUuids: device.serviceUuids,
        manufacturerData: device.manufacturerData,
      }));
      safeLogger.info("ble", "scan-complete", {
        candidates: result.length,
        names: result.map((device) => device.name),
        backend: "native-macos",
      });
      return result;
    }

    const found = new Map<string, DiscoveredDevice>();
    let batches = 0;

    safeLogger.info("ble", "scan-start", { timeoutMs, prefixes });

    try {
      await startScan((devices) => {
        batches += 1;
        let candidatesInBatch = 0;
        for (const device of devices) {
          if (!prefixes.some((prefix) => device.name?.toUpperCase().startsWith(prefix))) {
            continue;
          }

          candidatesInBatch += 1;
          const isNewCandidate = !found.has(device.address);
          found.set(device.address, {
            id: device.address,
            name: device.name || "Unknown BLE device",
            rssi: device.rssi,
            serviceUuids: device.services,
            manufacturerData: device.manufacturerData,
          });
          if (isNewCandidate) {
            safeLogger.info("ble", "candidate-discovered", {
              name: device.name || "Unknown BLE device",
              rssi: device.rssi ?? null,
              advertisedServiceCount: device.services.length,
              manufacturerIds: Object.keys(device.manufacturerData ?? {}),
            });
          }
        }
        if (batches === 1 || batches % 10 === 0) {
          safeLogger.debug("ble", "scan-progress", {
            batch: batches,
            devices: devices.length,
            candidatesInBatch,
            uniqueCandidates: found.size,
          });
        }
      }, timeoutMs);

      // plugin-blec starts its polling task in the background and resolves the
      // command immediately. Keep the JS call alive for the requested window;
      // otherwise stopScan() would cancel discovery before the first 200 ms poll.
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    } finally {
      await stopScan().catch(() => undefined);
    }
    const result = [...found.values()].sort(
      (left, right) => (right.rssi ?? -999) - (left.rssi ?? -999),
    );
    safeLogger.info("ble", "scan-complete", {
      batches,
      candidates: result.length,
      names: result.map((device) => device.name),
    });
    return result;
  }

  async connect(device: DiscoveredDevice): Promise<BleConnection> {
    if (await usesNativeMacBleBackend()) {
      return this.connectNativeMac(device);
    }

    safeLogger.info("ble", "connect-start", { name: device.name });
    await connect(device.id, null);
    safeLogger.info("ble", "connect-success", { name: device.name });

    return {
      device,
      async disconnect() {
        safeLogger.info("ble", "disconnect-start", { name: device.name });
        await disconnect();
        safeLogger.info("ble", "disconnect-complete", { name: device.name });
      },
      async read(service, characteristic) {
        safeLogger.debug("ble", "read", { service, characteristic });
        const value = new Uint8Array(await read(characteristic, service));
        safeLogger.debug("ble", "read-complete", {
          characteristic,
          bytes: value.length,
        });
        return value;
      },
      async write(service, characteristic, data, withResponse = true) {
        safeLogger.debug("ble", "write", {
          service,
          characteristic,
          bytes: data.length,
          withResponse,
        });
        await send(
          characteristic,
          [...data],
          withResponse ? "withResponse" : "withoutResponse",
          service,
        );
      },
      async subscribe(service, characteristic, listener) {
        safeLogger.info("ble", "subscribe-start", { service, characteristic });
        const onData = new Channel<number[]>();
        let notifications = 0;
        onData.onmessage = (data) => {
          notifications += 1;
          if (notifications <= 3 || notifications % 100 === 0) {
            safeLogger.debug("ble", "notification-received", {
              characteristic,
              bytes: data.length,
              notifications,
            });
          }
          listener(new Uint8Array(data));
        };
        await invoke("gan_ble_subscribe", {
          characteristic,
          service,
          onData,
        });
        safeLogger.info("ble", "subscribe-success", { characteristic });
        return async () => {
          safeLogger.info("ble", "unsubscribe-start", { characteristic });
          await unsubscribe(characteristic, service);
          safeLogger.info("ble", "unsubscribe-complete", { characteristic });
        };
      },
    };
  }

  private async connectNativeMac(device: DiscoveredDevice): Promise<BleConnection> {
    safeLogger.info("ble", "connect-start", { name: device.name, backend: "native-macos" });
    await invoke("native_ble_connect", { id: device.id, name: device.name });
    safeLogger.info("ble", "connect-success", { name: device.name, backend: "native-macos" });

    return {
      device,
      async disconnect() {
        safeLogger.info("ble", "disconnect-start", { name: device.name, backend: "native-macos" });
        await invoke("native_ble_disconnect");
        safeLogger.info("ble", "disconnect-complete", { name: device.name, backend: "native-macos" });
      },
      async read(service, characteristic) {
        safeLogger.debug("ble", "read", { service, characteristic, backend: "native-macos" });
        const value = new Uint8Array(
          await invoke<number[]>("native_ble_read", { service, characteristic }),
        );
        safeLogger.debug("ble", "read-complete", {
          characteristic,
          bytes: value.length,
          backend: "native-macos",
        });
        return value;
      },
      async write(service, characteristic, data, withResponse = true) {
        safeLogger.debug("ble", "write", {
          service,
          characteristic,
          bytes: data.length,
          withResponse,
          backend: "native-macos",
        });
        await invoke("native_ble_write", {
          service,
          characteristic,
          data: [...data],
          withResponse,
        });
      },
      async subscribe(service, characteristic, listener) {
        safeLogger.info("ble", "subscribe-start", {
          service,
          characteristic,
          backend: "native-macos",
        });
        const onData = new Channel<number[]>();
        let notifications = 0;
        onData.onmessage = (data) => {
          notifications += 1;
          if (notifications <= 3 || notifications % 100 === 0) {
            safeLogger.debug("ble", "notification-received", {
              characteristic,
              bytes: data.length,
              notifications,
              backend: "native-macos",
            });
          }
          listener(new Uint8Array(data));
        };
        await invoke("native_ble_subscribe", {
          service,
          characteristic,
          onData,
        });
        safeLogger.info("ble", "subscribe-success", {
          characteristic,
          backend: "native-macos",
        });
        return async () => {
          safeLogger.info("ble", "unsubscribe-start", {
            characteristic,
            backend: "native-macos",
          });
          await invoke("native_ble_unsubscribe", { service, characteristic });
          safeLogger.info("ble", "unsubscribe-complete", {
            characteristic,
            backend: "native-macos",
          });
        };
      },
    };
  }
}
