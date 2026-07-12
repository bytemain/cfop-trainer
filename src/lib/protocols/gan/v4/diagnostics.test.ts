import { describe, expect, it } from "vitest";
import type { CubeSignalFrameEvent } from "$lib/protocols/gan/types";
import { GanV4ProtocolDiagnostics } from "./diagnostics";

function frame(bytes: number[], packetType: CubeSignalFrameEvent["packetType"], receivedAt = 1): CubeSignalFrameEvent {
  return {
    bytes: Uint8Array.from(bytes),
    layer: "decrypted",
    packetType,
    receivedAt,
    protocol: "v4",
  };
}

function move(sequence: number): CubeSignalFrameEvent {
  const bytes = new Array<number>(20).fill(0);
  bytes[0] = 0x01;
  bytes[1] = 0x0a;
  bytes[6] = sequence & 0xff;
  bytes[7] = sequence >> 8;
  bytes[8] = 0x20;
  return frame(bytes, "move", sequence);
}

describe("GAN V4 runtime protocol diagnostics", () => {
  it("counts known packets and reports move sequence gaps without retaining raw bytes", () => {
    const diagnostics = new GanV4ProtocolDiagnostics();
    diagnostics.observe(move(100));
    const snapshot = diagnostics.observe(move(102));
    expect(snapshot.totalFrames).toBe(2);
    expect(snapshot.parsedFrames).toBe(2);
    expect(snapshot.packetCounts.move).toBe(2);
    expect(snapshot.moveSequenceGaps).toBe(1);
    expect(snapshot.issues).toEqual([
      expect.objectContaining({ code: "move-sequence-gap", count: 1, severity: "warning" }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("bytes");
  });

  it("surfaces unknown modes, invalid frames and the GAN16 zero-counter quirk", () => {
    const diagnostics = new GanV4ProtocolDiagnostics();
    diagnostics.observe(frame([0xaa, 0, ...new Array(18).fill(0)], "unknown", 1));
    diagnostics.observe({ ...frame([], "invalid", 2), layer: "encrypted" });

    const state = new Array<number>(20).fill(0);
    state[0] = 0xed;
    state[1] = 0x12;
    // A solved cubie payload is all-zero only for the first cubie; build the
    // remaining permutation fields explicitly.
    const setBits = (start: number, length: number, value: number) => {
      for (let offset = 0; offset < length; offset += 1) {
        const bitIndex = start + offset;
        const bit = (value >> (length - offset - 1)) & 1;
        if (bit) state[Math.floor(bitIndex / 8)] |= 1 << (7 - (bitIndex % 8));
      }
    };
    for (let index = 0; index < 7; index += 1) setBits(32 + index * 3, 3, index);
    for (let index = 0; index < 11; index += 1) setBits(69 + index * 4, 4, index);
    const snapshot = diagnostics.observe(frame(state, "snapshot", 3));

    expect(snapshot.unknownFrames).toBe(1);
    expect(snapshot.invalidFrames).toBe(1);
    expect(snapshot.snapshotZeroCounters).toBe(1);
    expect(snapshot.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "unknown-mode-aa",
      "packet-decode-failed",
      "snapshot-zero-counter",
    ]));
  });
});
