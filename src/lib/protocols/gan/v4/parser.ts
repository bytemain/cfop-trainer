import { cubieStateToFacelets, verifyCubieState, type GanCubieState } from "./cubie";

const MOVE_AXES = [2, 32, 8, 1, 16, 4] as const;
const MOVE_FACES = "URFDLB";

export interface GanV4MovePacket {
  type: "move";
  sequence: number;
  cubeTimestamp: number;
  move: string;
}

export interface GanV4SnapshotPacket {
  type: "snapshot";
  sequence: number;
  facelets: string;
}

export interface GanV4BatteryPacket {
  type: "battery";
  level: number;
}

export interface GanV4GyroPacket {
  type: "gyro";
  quaternion: { x: number; y: number; z: number; w: number };
  velocity: { x: number; y: number; z: number };
}

export interface GanV4HardwarePacket {
  type: "hardware";
  mode: number;
  value?: string;
}

export interface GanV4MoveHistoryPacket {
  type: "move-history";
  startSequence: number;
  moves: Array<{ sequence: number; move: string }>;
}

export interface GanV4UnknownPacket {
  type: "unknown";
  mode: number;
}

export type GanV4Packet =
  | GanV4MovePacket
  | GanV4SnapshotPacket
  | GanV4BatteryPacket
  | GanV4GyroPacket
  | GanV4HardwarePacket
  | GanV4MoveHistoryPacket
  | GanV4UnknownPacket;

function readBits(data: Uint8Array, start: number, length: number): number {
  let value = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const bitIndex = start + offset;
    value = (value << 1) | ((data[Math.floor(bitIndex / 8)] >> (7 - (bitIndex % 8))) & 1);
  }
  return value;
}

function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) |
    (data[offset + 3] << 24)) >>> 0;
}

function decodeSignedMagnitude(value: number, magnitudeMask: number, signBit: number): number {
  return (1 - ((value >> signBit) & 1) * 2) * (value & magnitudeMask) / magnitudeMask;
}

function parseSnapshot(data: Uint8Array): GanV4SnapshotPacket {
  const corners = new Uint8Array(8);
  const edges = new Uint8Array(12);
  let cornerCheck = 0xf00;
  let edgeCheck = 0;

  for (let index = 0; index < 7; index += 1) {
    const permutation = readBits(data, 32 + index * 3, 3);
    const orientation = readBits(data, 53 + index * 2, 2);
    cornerCheck -= orientation << 3;
    cornerCheck ^= permutation;
    corners[index] = (orientation << 3) | permutation;
  }
  corners[7] = ((cornerCheck & 0xff8) % 24) | (cornerCheck & 0x7);

  for (let index = 0; index < 11; index += 1) {
    const permutation = readBits(data, 69 + index * 4, 4);
    const orientation = readBits(data, 113 + index, 1);
    edgeCheck ^= (permutation << 1) | orientation;
    edges[index] = (permutation << 1) | orientation;
  }
  edges[11] = edgeCheck;

  const cubies: GanCubieState = { corners, edges };
  if (!verifyCubieState(cubies)) throw new Error("GAN V4 snapshot failed cubie verification");

  return {
    type: "snapshot",
    sequence: readUint16LE(data, 2),
    facelets: cubieStateToFacelets(cubies),
  };
}

export function parseGanV4Packet(data: Uint8Array): GanV4Packet {
  if (data.length < 16) throw new Error(`GAN V4 packet is too short: ${data.length}`);

  const mode = data[0];
  const length = data[1];
  if (mode === 0x01) {
    const power = data[8] >> 6;
    const axis = MOVE_AXES.indexOf((data[8] & 0x3f) as (typeof MOVE_AXES)[number]);
    if (axis < 0 || power > 1) throw new Error("GAN V4 move packet contains an invalid axis");
    return {
      type: "move",
      sequence: readUint16LE(data, 6),
      cubeTimestamp: readUint32LE(data, 2),
      move: `${MOVE_FACES[axis]}${power === 1 ? "'" : ""}`,
    };
  }

  if (mode === 0xed) return parseSnapshot(data);

  if (mode === 0xec) {
    const qw = readBits(data, 16, 16);
    const qx = readBits(data, 32, 16);
    const qy = readBits(data, 48, 16);
    const qz = readBits(data, 64, 16);
    const vx = readBits(data, 80, 4);
    const vy = readBits(data, 84, 4);
    const vz = readBits(data, 88, 4);
    return {
      type: "gyro",
      quaternion: {
        x: decodeSignedMagnitude(qx, 0x7fff, 15),
        y: decodeSignedMagnitude(qy, 0x7fff, 15),
        z: decodeSignedMagnitude(qz, 0x7fff, 15),
        w: decodeSignedMagnitude(qw, 0x7fff, 15),
      },
      velocity: {
        x: decodeSignedMagnitude(vx, 0x7, 3) * 7,
        y: decodeSignedMagnitude(vy, 0x7, 3) * 7,
        z: decodeSignedMagnitude(vz, 0x7, 3) * 7,
      },
    };
  }

  if (mode === 0xd1) {
    const startSequence = data[2];
    const count = Math.max(0, (length - 1) * 2);
    const moves: GanV4MoveHistoryPacket["moves"] = [];
    for (let index = 0; index < count; index += 1) {
      const axis = readBits(data, 24 + 4 * index, 3);
      const power = readBits(data, 27 + 4 * index, 1);
      if (axis < 6) {
        moves.push({
          sequence: (startSequence - index) & 0xff,
          move: `${"DUBFLR"[axis]}${power ? "'" : ""}`,
        });
      }
    }
    return { type: "move-history", startSequence, moves };
  }

  if (mode === 0xef) {
    const batteryOffset = 1 + length;
    if (batteryOffset >= data.length) throw new Error("GAN V4 battery response is truncated");
    return { type: "battery", level: data[batteryOffset] };
  }

  if ([0xf5, 0xf6, 0xfa, 0xfc, 0xfd, 0xfe, 0xff].includes(mode)) {
    let value: string | undefined;
    if (mode === 0xfc) {
      value = String.fromCharCode(...data.slice(3, 3 + Math.max(0, length - 1))).replace(/\0+$/, "");
    } else if (mode === 0xfd || mode === 0xfe) {
      value = `${data[3] >> 4}.${data[3] & 0xf}`;
    }
    return { type: "hardware", mode, value };
  }

  return { type: "unknown", mode };
}

export function createGanV4Request(kind: "snapshot" | "battery" | "hardware"): Uint8Array {
  const request = new Uint8Array(20);
  if (kind === "hardware") {
    request[0] = 0xdf;
    request[1] = 0x03;
  } else {
    request[0] = 0xdd;
    request[1] = 0x04;
    request[3] = kind === "snapshot" ? 0xed : 0xef;
  }
  return request;
}

export function createGanV4HistoryRequest(startSequence: number, count: number): Uint8Array {
  let alignedStart = startSequence & 0xff;
  let alignedCount = count;
  if (alignedStart % 2 === 0) alignedStart = (alignedStart - 1) & 0xff;
  if (alignedCount % 2 === 1) alignedCount += 1;
  alignedCount = Math.min(alignedCount, alignedStart + 1);

  const request = new Uint8Array(20);
  request[0] = 0xd1;
  request[1] = 0x04;
  request[2] = alignedStart;
  request[4] = alignedCount;
  return request;
}
