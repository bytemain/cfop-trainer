import type { CubeQuaternion, GanProtocolVersion } from "$lib/protocols/gan/types";
import type { Matrix3 } from "$lib/cube/orientation";

export type CubeColor = "white" | "yellow" | "red" | "orange" | "green" | "blue";
export type ProtocolAxis = "x" | "y" | "z";

export interface TimedQuaternionSample {
  at: number;
  quaternion: CubeQuaternion;
}

export interface TimedVelocitySample {
  at: number;
  velocity: { x: number; y: number; z: number };
}

export interface InMemorySignalFrame {
  at: number;
  layer: "decrypted" | "encrypted";
  packetType: string;
  bytes: Uint8Array;
}

export interface FrameFieldEvidence {
  layer: "decrypted" | "encrypted" | "mixed";
  packetTypes: string[];
  frameLengths: number[];
  staticPoseCandidateByteIndexes: number[];
  dynamicCandidateByteIndexes: Record<DynamicAxisCapture["physicalAxis"], number[]>;
  moveCandidateByteIndexes: number[];
  rawBytesPersisted: false;
}

export interface StaticPoseCapture {
  top: CubeColor;
  front: CubeColor;
  average: CubeQuaternion;
  sampleCount: number;
  maxAngularDeviationDeg: number;
  confidence: number;
}

export interface DynamicAxisCapture {
  physicalAxis: "red-orange" | "blue-green" | "white-yellow";
  positiveFace: CubeColor;
  protocolAxis: ProtocolAxis;
  sign: 1 | -1;
  sampleCount: number;
  activeSampleCount: number;
  dominance: number;
  confidence: number;
  signalSource: "angular-velocity" | "quaternion-delta";
  quaternionDeltaOrder?: "previous-inverse-current" | "current-previous-inverse";
}

export interface MoveValidationCapture {
  expected: string[];
  observed: string[];
  matched: boolean;
}

export interface RenderValidationCapture {
  confirmed: boolean;
}

export interface SignalCalibrationProfile {
  schemaVersion: 1;
  profileKind: "smart-cube-signal-calibration";
  deviceModel: string;
  protocol: GanProtocolVersion;
  createdAt: string;
  staticPoses: StaticPoseCapture[];
  dynamicAxes: DynamicAxisCapture[];
  moveValidation: MoveValidationCapture;
  renderValidation: RenderValidationCapture;
  frameFieldEvidence: FrameFieldEvidence;
  overallConfidence: number;
  privacy: {
    rawBlePersisted: false;
    rawQuaternionStreamPersisted: false;
    deviceAddressPersisted: false;
  };
}

const AXES: ProtocolAxis[] = ["x", "y", "z"];
const MODEL_VECTOR_FOR_POSITIVE_FACE: Record<CubeColor, [number, number, number]> = {
  red: [1, 0, 0],
  orange: [-1, 0, 0],
  white: [0, 1, 0],
  yellow: [0, -1, 0],
  green: [0, 0, 1],
  blue: [0, 0, -1],
};

export interface DerivedGyroCalibration {
  zero: CubeQuaternion;
  bodyToModel: Matrix3;
  confidence: number;
}

/**
 * Solves protocol-body -> rendered-model axes from the user's three controlled
 * whole-cube rotations. A signed protocol sample represents the requested
 * positive physical face, so each observed axis directly supplies one matrix
 * column. The first white-up/green-front capture is the user's persisted zero.
 */
export function deriveGyroCalibrationFromSignalProfile(
  profile: Pick<SignalCalibrationProfile, "staticPoses" | "dynamicAxes">,
): DerivedGyroCalibration | null {
  const zeroCapture = profile.staticPoses.find(
    (capture) => capture.top === "white" && capture.front === "green",
  );
  if (!zeroCapture) return null;

  const requiredPhysicalAxes: DynamicAxisCapture["physicalAxis"][] = [
    "red-orange",
    "blue-green",
    "white-yellow",
  ];
  const captures = requiredPhysicalAxes.map((physicalAxis) =>
    profile.dynamicAxes.find((capture) => capture.physicalAxis === physicalAxis),
  );
  if (captures.some((capture) => !capture)) return null;
  const completeCaptures = captures as DynamicAxisCapture[];
  if (new Set(completeCaptures.map((capture) => capture.protocolAxis)).size !== 3) return null;

  const columns: Array<[number, number, number] | null> = [null, null, null];
  for (const capture of completeCaptures) {
    const physical = MODEL_VECTOR_FOR_POSITIVE_FACE[capture.positiveFace];
    const column = physical.map((value) => value === 0 ? 0 : value * capture.sign) as [number, number, number];
    columns[AXES.indexOf(capture.protocolAxis)] = column;
  }
  if (columns.some((column) => !column)) return null;
  const [x, y, z] = columns as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  const bodyToModel: Matrix3 = [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];
  const determinant =
    bodyToModel[0][0] * (bodyToModel[1][1] * bodyToModel[2][2] - bodyToModel[1][2] * bodyToModel[2][1]) -
    bodyToModel[0][1] * (bodyToModel[1][0] * bodyToModel[2][2] - bodyToModel[1][2] * bodyToModel[2][0]) +
    bodyToModel[0][2] * (bodyToModel[1][0] * bodyToModel[2][1] - bodyToModel[1][1] * bodyToModel[2][0]);
  if (determinant !== 1) return null;

  return {
    zero: { ...zeroCapture.average },
    bodyToModel,
    confidence: Number((
      (zeroCapture.confidence + completeCaptures.reduce((sum, capture) => sum + capture.confidence, 0)) /
      (completeCaptures.length + 1)
    ).toFixed(3)),
  };
}

export function normalizeQuaternion(value: CubeQuaternion): CubeQuaternion {
  const length = Math.hypot(value.x, value.y, value.z, value.w) || 1;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

export function averageQuaternions(values: readonly CubeQuaternion[]): CubeQuaternion {
  if (values.length === 0) throw new Error("至少需要一个四元数样本");
  const reference = normalizeQuaternion(values[0]);
  const sum = values.reduce(
    (result, value) => {
      const normalized = normalizeQuaternion(value);
      const dot =
        reference.x * normalized.x +
        reference.y * normalized.y +
        reference.z * normalized.z +
        reference.w * normalized.w;
      const sign = dot < 0 ? -1 : 1;
      result.x += normalized.x * sign;
      result.y += normalized.y * sign;
      result.z += normalized.z * sign;
      result.w += normalized.w * sign;
      return result;
    },
    { x: 0, y: 0, z: 0, w: 0 },
  );
  return normalizeQuaternion(sum);
}

export function quaternionAngularDistanceDeg(
  left: CubeQuaternion,
  right: CubeQuaternion,
): number {
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

export function summarizeStaticPose(
  top: CubeColor,
  front: CubeColor,
  samples: readonly TimedQuaternionSample[],
): StaticPoseCapture {
  if (samples.length < 8) throw new Error("稳定样本不足，请保持姿态后再确认");
  const average = averageQuaternions(samples.map((sample) => sample.quaternion));
  const maxAngularDeviationDeg = Math.max(
    ...samples.map((sample) => quaternionAngularDistanceDeg(sample.quaternion, average)),
  );
  const stability = Math.max(0, Math.min(1, 1 - maxAngularDeviationDeg / 8));
  const coverage = Math.min(1, samples.length / 24);
  return {
    top,
    front,
    average,
    sampleCount: samples.length,
    maxAngularDeviationDeg: Number(maxAngularDeviationDeg.toFixed(3)),
    confidence: Number((stability * 0.75 + coverage * 0.25).toFixed(3)),
  };
}

export function summarizeDynamicAxis(
  physicalAxis: DynamicAxisCapture["physicalAxis"],
  positiveFace: CubeColor,
  samples: readonly TimedVelocitySample[],
  quaternionSamples: readonly TimedQuaternionSample[] = [],
): DynamicAxisCapture {
  const velocityMagnitudes = samples.map(({ velocity }) =>
    Math.hypot(velocity.x, velocity.y, velocity.z),
  );
  const velocityPeak = velocityMagnitudes.length > 0 ? Math.max(...velocityMagnitudes) : 0;
  const velocityThreshold = Math.max(0.5, velocityPeak * 0.18);
  const activeVelocity = samples.filter(
    (_, index) => velocityMagnitudes[index] >= velocityThreshold,
  );
  if (activeVelocity.length >= 3 && velocityPeak >= 0.5) {
    return summarizeAxisVectors(
      physicalAxis,
      positiveFace,
      activeVelocity.map((sample) => sample.velocity),
      samples.length,
      "angular-velocity",
    );
  }

  const deltaCandidates = quaternionDeltaCandidates(quaternionSamples);
  const best = deltaCandidates.sort((left, right) => right.dominance - left.dominance)[0];
  if (!best || best.vectors.length < 3) {
    throw new Error("没有检测到明确旋转；请点击开始后将整颗魔方转动至少 20°");
  }
  return summarizeAxisVectors(
    physicalAxis,
    positiveFace,
    best.vectors,
    quaternionSamples.length,
    "quaternion-delta",
    best.order,
  );
}

function summarizeAxisVectors(
  physicalAxis: DynamicAxisCapture["physicalAxis"],
  positiveFace: CubeColor,
  vectors: readonly { x: number; y: number; z: number }[],
  sampleCount: number,
  signalSource: DynamicAxisCapture["signalSource"],
  quaternionDeltaOrder?: DynamicAxisCapture["quaternionDeltaOrder"],
): DynamicAxisCapture {
  const energy = { x: 0, y: 0, z: 0 };
  const signed = { x: 0, y: 0, z: 0 };
  for (const vector of vectors) {
    for (const axis of AXES) {
      energy[axis] += Math.abs(vector[axis]);
      signed[axis] += vector[axis];
    }
  }
  const protocolAxis = AXES.reduce((best, axis) =>
    energy[axis] > energy[best] ? axis : best,
  );
  const totalEnergy = energy.x + energy.y + energy.z || 1;
  const dominance = energy[protocolAxis] / totalEnergy;
  const activity = Math.min(1, vectors.length / 10);
  return {
    physicalAxis,
    positiveFace,
    protocolAxis,
    sign: signed[protocolAxis] < 0 ? -1 : 1,
    sampleCount,
    activeSampleCount: vectors.length,
    dominance: Number(dominance.toFixed(3)),
    confidence: Number((dominance * 0.8 + activity * 0.2).toFixed(3)),
    signalSource,
    quaternionDeltaOrder,
  };
}

function multiplyRaw(left: CubeQuaternion, right: CubeQuaternion): CubeQuaternion {
  return normalizeQuaternion({
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  });
}

function conjugate(value: CubeQuaternion): CubeQuaternion {
  const normalized = normalizeQuaternion(value);
  return { x: -normalized.x, y: -normalized.y, z: -normalized.z, w: normalized.w };
}

function alignedTo(reference: CubeQuaternion, value: CubeQuaternion): CubeQuaternion {
  const normalizedReference = normalizeQuaternion(reference);
  const normalizedValue = normalizeQuaternion(value);
  const dot =
    normalizedReference.x * normalizedValue.x +
    normalizedReference.y * normalizedValue.y +
    normalizedReference.z * normalizedValue.z +
    normalizedReference.w * normalizedValue.w;
  return dot < 0
    ? { x: -normalizedValue.x, y: -normalizedValue.y, z: -normalizedValue.z, w: -normalizedValue.w }
    : normalizedValue;
}

function quaternionDeltaCandidates(samples: readonly TimedQuaternionSample[]): Array<{
  order: NonNullable<DynamicAxisCapture["quaternionDeltaOrder"]>;
  vectors: Array<{ x: number; y: number; z: number }>;
  dominance: number;
}> {
  const orders: Array<NonNullable<DynamicAxisCapture["quaternionDeltaOrder"]>> = [
    "previous-inverse-current",
    "current-previous-inverse",
  ];
  return orders.map((order) => {
    const vectors: Array<{ x: number; y: number; z: number }> = [];
    for (let index = 1; index < samples.length; index += 1) {
      const previous = normalizeQuaternion(samples[index - 1].quaternion);
      const current = alignedTo(previous, samples[index].quaternion);
      const delta = order === "previous-inverse-current"
        ? multiplyRaw(conjugate(previous), current)
        : multiplyRaw(current, conjugate(previous));
      const stepAngle = quaternionAngularDistanceDeg(previous, current);
      if (stepAngle < 0.08 || stepAngle > 20) continue;
      vectors.push({ x: delta.x, y: delta.y, z: delta.z });
    }
    const energy = AXES.map((axis) =>
      vectors.reduce((sum, vector) => sum + Math.abs(vector[axis]), 0),
    );
    const total = energy.reduce((sum, value) => sum + value, 0) || 1;
    return { order, vectors, dominance: Math.max(...energy, 0) / total };
  });
}

export function normalizeObservedMove(move: string): string {
  return move.trim().replace(/’/g, "'").toUpperCase();
}

export function summarizeMoveValidation(
  expected: readonly string[],
  observed: readonly string[],
): MoveValidationCapture {
  const normalizedExpected = expected.map(normalizeObservedMove);
  const normalizedObserved = observed.map(normalizeObservedMove);
  return {
    expected: normalizedExpected,
    observed: normalizedObserved,
    matched:
      normalizedExpected.length === normalizedObserved.length &&
      normalizedExpected.every((move, index) => move === normalizedObserved[index]),
  };
}

function changingByteIndexes(frames: readonly InMemorySignalFrame[]): number[] {
  if (frames.length < 2) return [];
  const comparableLength = Math.min(...frames.map((frame) => frame.bytes.length));
  const indexes: number[] = [];
  for (let index = 0; index < comparableLength; index += 1) {
    const first = frames[0].bytes[index];
    const changed = frames.slice(1).filter((frame) => frame.bytes[index] !== first).length;
    if (changed / (frames.length - 1) >= 0.2) indexes.push(index);
  }
  return indexes;
}

export function summarizeFrameFieldEvidence(input: {
  staticPoseGroups: readonly (readonly InMemorySignalFrame[])[];
  dynamicGroups: Partial<Record<DynamicAxisCapture["physicalAxis"], readonly InMemorySignalFrame[]>>;
  moveFrames: readonly InMemorySignalFrame[];
}): FrameFieldEvidence {
  const frames = [
    ...input.staticPoseGroups.flat(),
    ...Object.values(input.dynamicGroups).flat(),
    ...input.moveFrames,
  ];
  const layers = [...new Set(frames.map((frame) => frame.layer))];
  const gyroGroups = input.staticPoseGroups
    .map((group) => group.filter((frame) => frame.packetType === "gyro"))
    .filter((group) => group.length > 0);
  const comparableLength = gyroGroups.length > 0
    ? Math.min(...gyroGroups.flat().map((frame) => frame.bytes.length))
    : 0;
  const staticPoseCandidateByteIndexes: number[] = [];
  for (let index = 0; index < comparableLength; index += 1) {
    const means = gyroGroups.map((group) =>
      group.reduce((sum, frame) => sum + frame.bytes[index], 0) / group.length,
    );
    const betweenPoseRange = Math.max(...means) - Math.min(...means);
    const meanWithinPoseRange = gyroGroups.reduce((sum, group) => {
      const values = group.map((frame) => frame.bytes[index]);
      return sum + Math.max(...values) - Math.min(...values);
    }, 0) / gyroGroups.length;
    if (betweenPoseRange >= 3 && betweenPoseRange > meanWithinPoseRange * 1.4) {
      staticPoseCandidateByteIndexes.push(index);
    }
  }
  return {
    layer: layers.length === 1 ? layers[0] : layers.length === 0 ? "decrypted" : "mixed",
    packetTypes: [...new Set(frames.map((frame) => frame.packetType))].sort(),
    frameLengths: [...new Set(frames.map((frame) => frame.bytes.length))].sort((a, b) => a - b),
    staticPoseCandidateByteIndexes,
    dynamicCandidateByteIndexes: {
      "red-orange": changingByteIndexes(input.dynamicGroups["red-orange"] ?? []),
      "blue-green": changingByteIndexes(input.dynamicGroups["blue-green"] ?? []),
      "white-yellow": changingByteIndexes(input.dynamicGroups["white-yellow"] ?? []),
    },
    moveCandidateByteIndexes: changingByteIndexes(
      input.moveFrames.filter((frame) => frame.packetType === "move" || frame.packetType === "unknown"),
    ),
    rawBytesPersisted: false,
  };
}

export function createSignalCalibrationProfile(input: {
  deviceModel: string;
  protocol: GanProtocolVersion;
  staticPoses: StaticPoseCapture[];
  dynamicAxes: DynamicAxisCapture[];
  moveValidation: MoveValidationCapture;
  renderValidation: RenderValidationCapture;
  frameFieldEvidence: FrameFieldEvidence;
  now?: Date;
}): SignalCalibrationProfile {
  const confidenceValues = [
    ...input.staticPoses.map((capture) => capture.confidence),
    ...input.dynamicAxes.map((capture) => capture.confidence),
    input.moveValidation.matched ? 1 : 0,
    input.renderValidation.confirmed ? 1 : 0,
  ];
  const overallConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;
  return {
    schemaVersion: 1,
    profileKind: "smart-cube-signal-calibration",
    deviceModel: input.deviceModel,
    protocol: input.protocol,
    createdAt: (input.now ?? new Date()).toISOString(),
    staticPoses: input.staticPoses,
    dynamicAxes: input.dynamicAxes,
    moveValidation: input.moveValidation,
    renderValidation: input.renderValidation,
    frameFieldEvidence: input.frameFieldEvidence,
    overallConfidence: Number(overallConfidence.toFixed(3)),
    privacy: {
      rawBlePersisted: false,
      rawQuaternionStreamPersisted: false,
      deviceAddressPersisted: false,
    },
  };
}

export function serializeSignalCalibrationProfile(profile: SignalCalibrationProfile): string {
  return JSON.stringify(profile, null, 2);
}
