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

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
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

  it("uses a freshly confirmed state instead of the first queued snapshot", async () => {
    const device: DiscoveredDevice = {
      id: "queued-state-device",
      name: "GAN16ui_QUEUED_STATE",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const cipher = new GanV2Cipher(deriveGanV2CipherMaterial(extractGanHardwareAddress(device.manufacturerData)!));
    let notify: ((data: Uint8Array) => void) | undefined;
    let snapshotRequests = 0;
    const queuedScrambledState = fromHex("ed0e930011f5ab5492280cdd133c4e1800005727");
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
        if (request[0] !== 0xdd || request[3] !== 0xed) return;
        snapshotRequests += 1;
        const response = snapshotRequests === 1
          ? queuedScrambledState
          : solvedSnapshot(0x1234);
        queueMicrotask(() => notify?.(cipher.encode(response)));
      }),
    };

    const session = await new GanV4Protocol().open(connection);
    await expect(session.initialSnapshot()).resolves.toMatchObject({
      sequence: 0x1234,
      facelets: "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB",
    });
    expect(snapshotRequests).toBe(3);
    await session.disconnect();
  });

  it("writes CubeStation's solved cubie state and verifies it with 0xED", async () => {
    const device: DiscoveredDevice = {
      id: "state-reset-device",
      name: "GAN16ui_STATE_RESET",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const cipher = new GanV2Cipher(deriveGanV2CipherMaterial(extractGanHardwareAddress(device.manufacturerData)!));
    let notify: ((data: Uint8Array) => void) | undefined;
    let logicalStateSolved = false;
    let resetRequest: Uint8Array | null = null;
    const staleScrambledState = fromHex("ed0e930011f5ab5492280cdd133c4e1800005727");
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
        if (request[0] === 0xd2) {
          resetRequest = request;
          logicalStateSolved = true;
          return;
        }
        if (request[0] === 0xdd && request[3] === 0xed) {
          const response = logicalStateSolved ? solvedSnapshot(5) : staleScrambledState;
          queueMicrotask(() => notify?.(cipher.encode(response)));
        }
      }),
    };

    const session = await new GanV4Protocol().open(connection);
    await expect(session.initialSnapshot()).resolves.toMatchObject({ sequence: 147 });
    await expect(session.writeSolvedState?.()).resolves.toMatchObject({
      sequence: 5,
      facelets: "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB",
    });
    expect(resetRequest).not.toBeNull();
    expect(resetRequest).toEqual(fromHex("d20d05397700000123456789ab00000000000000"));
    await session.disconnect();
  });

  it("emits the first real move when the initial snapshot and move both use sequence zero", async () => {
    const device: DiscoveredDevice = {
      id: "zero-counter-device",
      name: "GAN16ui_ZERO_COUNTER",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const cipher = new GanV2Cipher(deriveGanV2CipherMaterial(extractGanHardwareAddress(device.manufacturerData)!));
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
          queueMicrotask(() => notify?.(cipher.encode(solvedSnapshot(0))));
        }
      }),
    };

    const session = await new GanV4Protocol().open(connection);
    await expect(session.initialSnapshot()).resolves.toMatchObject({ sequence: 0 });
    const moves: CubeMoveEvent[] = [];
    await session.moves((event) => moves.push(event));

    notify?.(cipher.encode(movePacket(0, 0x20, 1234)));

    expect(moves).toEqual([
      expect.objectContaining({ move: "R", sequence: 0, cubeTimestamp: 1234, source: "live" }),
    ]);
    await session.disconnect();
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

  it("keeps emitting moves across the 8-bit counter wrap 255 -> 0", async () => {
    const device: DiscoveredDevice = {
      id: "wrap-device",
      name: "GAN16ui_WRAP",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const cipher = new GanV2Cipher(deriveGanV2CipherMaterial(extractGanHardwareAddress(device.manufacturerData)!));
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
          queueMicrotask(() => notify?.(cipher.encode(solvedSnapshot(253))));
        }
      }),
    };

    const session = await new GanV4Protocol().open(connection);
    await session.initialSnapshot();
    const moves: CubeMoveEvent[] = [];
    await session.moves((event) => moves.push(event));

    // The GAN16ui counter is 8-bit on the wire: 254, 255, then 0, 1, 2.
    for (const sequence of [254, 255, 0, 1, 2]) {
      notify?.(cipher.encode(movePacket(sequence)));
    }
    // The wrap must extend into the internal 16-bit space instead of being
    // dropped as a 65281-step backward jump.
    expect(moves.map((event) => event.sequence)).toEqual([254, 255, 256, 257, 258]);

    // A stale retransmission of 255 after the wrap must stay deduplicated.
    notify?.(cipher.encode(movePacket(255)));
    expect(moves.map((event) => event.sequence)).toEqual([254, 255, 256, 257, 258]);
    await session.disconnect();
  });

  it("re-baselines the move stream on a requested snapshot after a wrap", async () => {
    const device: DiscoveredDevice = {
      id: "rebaseline-device",
      name: "GAN16ui_REBASELINE",
      serviceUuids: [],
      manufacturerData: { 1: [9, 9, 9, 0, 1, 2, 3, 4, 5] },
    };
    const cipher = new GanV2Cipher(deriveGanV2CipherMaterial(extractGanHardwareAddress(device.manufacturerData)!));
    let notify: ((data: Uint8Array) => void) | undefined;
    let snapshotSequence = 253;
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
          const sequence = snapshotSequence;
          queueMicrotask(() => notify?.(cipher.encode(solvedSnapshot(sequence))));
        }
      }),
    };

    const session = await new GanV4Protocol().open(connection);
    await session.initialSnapshot();
    const moves: CubeMoveEvent[] = [];
    await session.moves((event) => moves.push(event));

    for (const sequence of [254, 255, 0]) {
      notify?.(cipher.encode(movePacket(sequence)));
    }
    expect(moves.map((event) => event.sequence)).toEqual([254, 255, 256]);

    // A resync snapshot reports the raw 8-bit counter; the adapter must
    // re-baseline on it so trainer and adapter agree again.
    snapshotSequence = 3;
    await expect(session.requestSnapshot()).resolves.toMatchObject({ sequence: 3 });

    notify?.(cipher.encode(movePacket(4)));
    expect(moves.map((event) => event.sequence)).toEqual([254, 255, 256, 4]);
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
