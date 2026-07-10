import { describe, expect, it } from "vitest";
import {
  createGanV4HistoryRequest,
  createGanV4Request,
  parseGanV4Packet,
} from "./parser";

const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function setBits(data: Uint8Array, start: number, length: number, value: number): void {
  for (let offset = 0; offset < length; offset += 1) {
    const bitIndex = start + offset;
    const bit = (value >> (length - offset - 1)) & 1;
    const mask = 1 << (7 - (bitIndex % 8));
    if (bit) data[Math.floor(bitIndex / 8)] |= mask;
    else data[Math.floor(bitIndex / 8)] &= ~mask;
  }
}

function solvedSnapshotFixture(): Uint8Array {
  const packet = new Uint8Array(20);
  packet[0] = 0xed;
  packet[1] = 0x12;
  packet[2] = 0x34;
  packet[3] = 0x12;
  for (let index = 0; index < 7; index += 1) {
    setBits(packet, 32 + index * 3, 3, index);
    setBits(packet, 53 + index * 2, 2, 0);
  }
  for (let index = 0; index < 11; index += 1) {
    setBits(packet, 69 + index * 4, 4, index);
    setBits(packet, 113 + index, 1, 0);
  }
  return packet;
}

describe("GAN V4 packet parser", () => {
  it("accepts a sanitized snapshot captured from the GAN16 ui", () => {
    const packet = parseGanV4Packet(fromHex("ed0e930011f5ab5492280cdd133c4e1800005727"));
    expect(packet.type).toBe("snapshot");
    if (packet.type !== "snapshot") return;
    expect(packet.sequence).toBe(147);
    expect(packet.facelets).toHaveLength(54);
    for (const face of "URFDLB") {
      expect([...packet.facelets].filter((facelet) => facelet === face)).toHaveLength(9);
    }
  });

  it("decodes a verified solved cubie snapshot", () => {
    expect(parseGanV4Packet(solvedSnapshotFixture())).toEqual({
      type: "snapshot",
      sequence: 0x1234,
      facelets: SOLVED_FACELETS,
    });
  });

  it("decodes move, timestamp, counter and battery fields", () => {
    const move = new Uint8Array(20);
    move.set([0x01, 0x0a, 0x78, 0x56, 0x34, 0x12, 0xcd, 0xab, 0x60]);
    expect(parseGanV4Packet(move)).toEqual({
      type: "move",
      sequence: 0xabcd,
      cubeTimestamp: 0x12345678,
      move: "R'",
    });

    const battery = new Uint8Array(20);
    battery.set([0xef, 0x04, 0, 0, 0, 87]);
    expect(parseGanV4Packet(battery)).toEqual({ type: "battery", level: 87 });
  });

  it("builds the public V4 request formats and aligns history windows", () => {
    expect([...createGanV4Request("snapshot").slice(0, 4)]).toEqual([0xdd, 0x04, 0, 0xed]);
    expect([...createGanV4Request("battery").slice(0, 4)]).toEqual([0xdd, 0x04, 0, 0xef]);
    expect([...createGanV4Request("hardware").slice(0, 4)]).toEqual([0xdf, 0x03, 0, 0]);
    expect([...createGanV4HistoryRequest(10, 3).slice(0, 6)]).toEqual([0xd1, 0x04, 9, 0, 4, 0]);
  });
});
