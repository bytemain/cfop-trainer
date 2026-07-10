import { describe, expect, it, vi } from "vitest";
import type { BleConnection, DiscoveredDevice } from "$lib/ble/types";
import { GanV4Protocol } from "./adapter";
import {
  deriveGanV2CipherMaterial,
  extractGanHardwareAddress,
  GanV2Cipher,
} from "./crypto";

function setBits(data: Uint8Array, start: number, length: number, value: number): void {
  for (let offset = 0; offset < length; offset += 1) {
    const bitIndex = start + offset;
    const bit = (value >> (length - offset - 1)) & 1;
    const mask = 1 << (7 - (bitIndex % 8));
    if (bit) data[Math.floor(bitIndex / 8)] |= mask;
  }
}

function solvedSnapshot(sequence: number): Uint8Array {
  const packet = new Uint8Array(20);
  packet.set([0xed, 0x12, sequence & 0xff, sequence >> 8]);
  for (let index = 0; index < 7; index += 1) setBits(packet, 32 + index * 3, 3, index);
  for (let index = 0; index < 11; index += 1) setBits(packet, 69 + index * 4, 4, index);
  return packet;
}

describe("GAN V4 session", () => {
  it("connects requests, encrypted notifications and domain events end to end", async () => {
    const device: DiscoveredDevice = {
      id: "fixture-device",
      name: "GAN16ui_FIXTURE",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const address = extractGanHardwareAddress(device.manufacturerData);
    if (!address) throw new Error("fixture address missing");
    const cipher = new GanV2Cipher(deriveGanV2CipherMaterial(address));
    let notify: ((data: Uint8Array) => void) | undefined;

    const connection: BleConnection = {
      device,
      disconnect: vi.fn(async () => undefined),
      read: vi.fn(async () => new Uint8Array()),
      subscribe: vi.fn(async (_service, _characteristic, listener) => {
        notify = listener;
        return async () => undefined;
      }),
      write: vi.fn(async (_service, _characteristic, encrypted) => {
        const request = cipher.decode(encrypted);
        let response: Uint8Array | undefined;
        if (request[0] === 0xdd && request[3] === 0xed) response = solvedSnapshot(0x1234);
        if (request[0] === 0xdd && request[3] === 0xef) {
          response = new Uint8Array(20);
          response.set([0xef, 0x04, 0, 0, 0, 76]);
        }
        if (response) queueMicrotask(() => notify?.(cipher.encode(response)));
      }),
    };

    const adapter = new GanV4Protocol();
    expect(adapter.match(device)?.protocol).toBe("v4");
    const session = await adapter.open(connection);
    await expect(session.initialSnapshot()).resolves.toMatchObject({
      sequence: 0x1234,
      facelets: "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB",
    });

    const listener = vi.fn();
    await session.moves(listener);
    const move = new Uint8Array(20);
    move.set([0x01, 0x0a, 0x78, 0x56, 0x34, 0x12, 0x35, 0x12, 0x20]);
    notify?.(cipher.encode(move));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ move: "R", sequence: 0x1235, cubeTimestamp: 0x12345678 }),
    );
    await expect(session.batteryLevel()).resolves.toBe(76);

    await session.disconnect();
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });
});
