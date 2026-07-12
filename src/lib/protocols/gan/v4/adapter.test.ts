import { describe, expect, it, vi } from "vitest";
import type { BleConnection, DiscoveredDevice } from "$lib/ble/types";
import type { CubeContinuityEvent, CubeMoveEvent } from "$lib/protocols/gan/types";
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

function movePacket(sequence: number, moveAxis = 0x20, timestamp = sequence * 10): Uint8Array {
  const packet = new Uint8Array(20);
  packet.set([
    0x01,
    0x0a,
    timestamp & 0xff,
    (timestamp >> 8) & 0xff,
    (timestamp >> 16) & 0xff,
    (timestamp >> 24) & 0xff,
    sequence & 0xff,
    sequence >> 8,
    moveAxis,
  ]);
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
    const move = movePacket(0x1235, 0x20, 0x12345678);
    notify?.(cipher.encode(move));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ move: "R", sequence: 0x1235, cubeTimestamp: 0x12345678 }),
    );

    // GAN16ui may broadcast a valid state packet with counter 0. It must not
    // rewind an already established live move baseline.
    notify?.(cipher.encode(solvedSnapshot(0)));
    notify?.(cipher.encode(movePacket(0x1236, 0x08, 0x12345679)));
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ move: "F", sequence: 0x1236, cubeTimestamp: 0x12345679 }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
    await expect(session.batteryLevel()).resolves.toBe(76);

    await session.disconnect();
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it("recovers a 16-bit live sequence gap from 8-bit V4 history before emitting", async () => {
    const device: DiscoveredDevice = {
      id: "history-device",
      name: "GAN16ui_HISTORY",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const address = extractGanHardwareAddress(device.manufacturerData)!;
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
        if (request[0] === 0xdd && request[3] === 0xed) {
          queueMicrotask(() => notify?.(cipher.encode(solvedSnapshot(0x1234))));
        }
        if (request[0] === 0xd1) {
          // Descending low-byte counters: 0x37 R, 0x36 U, 0x35 F.
          const history = new Uint8Array(20);
          history.set([0xd1, 0x03, 0x37, 0xa2, 0x6f]);
          queueMicrotask(() => notify?.(cipher.encode(history)));
        }
      }),
    };

    const session = await new GanV4Protocol().open(connection);
    await session.initialSnapshot();
    const moves: CubeMoveEvent[] = [];
    const continuity: CubeContinuityEvent[] = [];
    await session.moves((event) => moves.push(event));
    await session.continuity((event) => continuity.push(event));

    notify?.(cipher.encode(movePacket(0x1237)));
    await vi.waitFor(() => expect(moves).toHaveLength(3));
    expect(moves.map((event) => [event.sequence, event.move, event.source])).toEqual([
      [0x1235, "F", "history"],
      [0x1236, "U", "history"],
      [0x1237, "R", "live"],
    ]);
    expect(continuity.map((event) => event.type)).toEqual([
      "history-recovery-started",
      "history-recovered",
    ]);
    expect(connection.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Uint8Array),
      true,
    );
    await session.disconnect();
  });

  it("falls back to a snapshot only after history retries and reports a discontinuity", async () => {
    const device: DiscoveredDevice = {
      id: "fallback-device",
      name: "GAN16ui_FALLBACK",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const cipher = new GanV2Cipher(deriveGanV2CipherMaterial(extractGanHardwareAddress(device.manufacturerData)!));
    let notify: ((data: Uint8Array) => void) | undefined;
    let snapshotSequence = 0x1234;
    let historyRequests = 0;
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
        if (request[0] === 0xd1) historyRequests += 1;
        if (request[0] === 0xdd && request[3] === 0xed) {
          queueMicrotask(() => notify?.(cipher.encode(solvedSnapshot(snapshotSequence))));
        }
      }),
    };
    const session = await new GanV4Protocol().open(connection);
    await session.initialSnapshot();
    const continuity: CubeContinuityEvent[] = [];
    await session.continuity((event) => continuity.push(event));
    snapshotSequence = 0x1237;

    vi.useFakeTimers();
    try {
      notify?.(cipher.encode(movePacket(0x1237)));
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.waitFor(() => expect(continuity.at(-1)?.type).toBe("discontinuity"));
      expect(historyRequests).toBe(3);
      expect(continuity.at(-1)?.snapshot?.sequence).toBe(0x1237);
      expect(continuity.at(-1)?.reason).toBe("move-history-timeout");
    } finally {
      vi.useRealTimers();
      await session.disconnect();
    }
  });
});
