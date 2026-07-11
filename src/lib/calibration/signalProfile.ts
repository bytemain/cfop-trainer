import type { CubeQuaternion, GanProtocolVersion } from "$lib/protocols/gan/types";
import {
  applyMatrix3,
  multiplyMatrix3,
  quaternionMatrix,
  rotationDistanceDeg,
  transposeMatrix3,
  type Matrix3,
  type SensorRelativeOrder,
} from "$lib/cube/orientation";

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
  motionDirection?: "clockwise" | "counterclockwise";
  targetAngleDeg?: 90 | 180;
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

export interface CompoundMotionValidationCapture {
  sampleCount: number;
  pathRotationDeg: number;
  axisCoverage: { x: number; y: number; z: number };
  returnToReferenceErrorDeg: number;
  passed: boolean;
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
  compoundMotionValidation?: CompoundMotionValidationCapture;
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
  valid: boolean;
  zero: CubeQuaternion;
  bodyToModel: Matrix3;
  relativeOrder: SensorRelativeOrder;
  meanPoseErrorDeg: number;
  maxPoseErrorDeg: number;
  confidence: number;
}

const SENSOR_RELATIVE_ORDERS: SensorRelativeOrder[] = [
  "current-reference-inverse",
  "reference-current-inverse",
];

function determinant3(matrix: Matrix3): number {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

function permutations(values: number[]): number[][] {
  if (values.length === 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index))
      .map((rest) => [value, ...rest]),
  );
}

function properAxisRotations(): Matrix3[] {
  const result: Matrix3[] = [];
  for (const permutation of permutations([0, 1, 2])) {
    for (const xSign of [-1, 1]) for (const ySign of [-1, 1]) for (const zSign of [-1, 1]) {
      const matrix: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      [xSign, ySign, zSign].forEach((sign, column) => {
        matrix[permutation[column]][column] = sign;
      });
      if (determinant3(matrix) === 1) result.push(matrix);
    }
  }
  return result;
}

function cross(
  left: [number, number, number],
  right: [number, number, number],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

/** Active cube-body -> canonical-world pose for a declared top/front pair. */
export function expectedCubePoseMatrix(top: CubeColor, front: CubeColor): Matrix3 {
  const topVector = MODEL_VECTOR_FOR_POSITIVE_FACE[top];
  const frontVector = MODEL_VECTOR_FOR_POSITIVE_FACE[front];
  const rightVector = cross(topVector, frontVector);
  return [rightVector, topVector, frontVector];
}

function relativeSensorMatrix(
  reference: Matrix3,
  current: Matrix3,
  order: SensorRelativeOrder,
): Matrix3 {
  return order === "current-reference-inverse"
    ? multiplyMatrix3(current, transposeMatrix3(reference))
    : multiplyMatrix3(reference, transposeMatrix3(current));
}

function protocolAxisVector(capture: DynamicAxisCapture): [number, number, number] {
  const vector: [number, number, number] = [0, 0, 0];
  vector[AXES.indexOf(capture.protocolAxis)] = capture.sign;
  return vector;
}

function capturedRelativeOrder(capture: DynamicAxisCapture): SensorRelativeOrder | null {
  if (capture.quaternionDeltaOrder === "current-previous-inverse") {
    return "current-reference-inverse";
  }
  if (capture.quaternionDeltaOrder === "previous-inverse-current") {
    return "reference-current-inverse";
  }
  return null;
}

/**
 * Jointly solves the only two unknowns allowed by the pose SSOT: the sensor
 * delta direction and one proper signed-axis rotation into cube coordinates.
 * Static poses score the full rigid orientation; controlled clockwise turns
 * independently score axis direction. No renderer convention participates.
 */
export function deriveGyroCalibrationFromSignalProfile(
  profile: Pick<SignalCalibrationProfile, "staticPoses" | "dynamicAxes">,
): DerivedGyroCalibration | null {
  const zeroCapture = profile.staticPoses.find(
    (capture) => capture.top === "white" && capture.front === "green",
  );
  if (!zeroCapture) return null;

  if (profile.staticPoses.length < 3 || profile.dynamicAxes.length < 3) return null;
  const reference = quaternionMatrix(zeroCapture.average);
  const candidates = properAxisRotations().flatMap((bodyToModel) =>
    SENSOR_RELATIVE_ORDERS.map((relativeOrder) => {
      const poseErrors = profile.staticPoses.map((capture) => {
        const relative = relativeSensorMatrix(
          reference,
          quaternionMatrix(capture.average),
          relativeOrder,
        );
        const predicted = multiplyMatrix3(
          multiplyMatrix3(bodyToModel, relative),
          transposeMatrix3(bodyToModel),
        );
        return rotationDistanceDeg(predicted, expectedCubePoseMatrix(capture.top, capture.front));
      });
      const directionErrors = profile.dynamicAxes
        .filter((capture) => capture.targetAngleDeg !== 180)
        .map((capture) => {
        let sensorAxis = protocolAxisVector(capture);
        const captureOrder = capturedRelativeOrder(capture);
        if (captureOrder && captureOrder !== relativeOrder) {
          sensorAxis = sensorAxis.map((value) => -value) as [number, number, number];
        }
        const mapped = applyMatrix3(bodyToModel, sensorAxis);
        // The guide asks the user to look at the positive face and rotate the
        // whole cube clockwise: right-hand angle is negative about that face.
        const expectedSign = capture.motionDirection === "counterclockwise" ? 1 : -1;
        const expected = MODEL_VECTOR_FOR_POSITIVE_FACE[capture.positiveFace]
          .map((value) => value * expectedSign) as [number, number, number];
        const dot = Math.max(-1, Math.min(1, mapped.reduce(
          (sum, value, index) => sum + value * expected[index],
          0,
        )));
        return (Math.acos(dot) * 180) / Math.PI;
        });
      const meanPoseErrorDeg = poseErrors.reduce((sum, value) => sum + value, 0) / poseErrors.length;
      const meanDirectionErrorDeg = directionErrors.reduce((sum, value) => sum + value, 0) / directionErrors.length;
      return {
        bodyToModel,
        relativeOrder,
        meanPoseErrorDeg,
        maxPoseErrorDeg: Math.max(...poseErrors),
        meanDirectionErrorDeg,
        score: meanPoseErrorDeg + meanDirectionErrorDeg * 2,
      };
    }),
  ).sort((left, right) => left.score - right.score);
  const best = candidates[0];
  if (!best || best.meanDirectionErrorDeg > 1) return null;
  const sampleConfidence = [
    ...profile.staticPoses.map((capture) => capture.confidence),
    ...profile.dynamicAxes.map((capture) => capture.confidence),
  ].reduce((sum, value) => sum + value, 0) / (profile.staticPoses.length + profile.dynamicAxes.length);
  const geometricConfidence = Math.max(0, 1 - best.meanPoseErrorDeg / 45);
  return {
    valid: best.meanPoseErrorDeg <= 10 && best.maxPoseErrorDeg <= 20,
    zero: { ...zeroCapture.average },
    bodyToModel: best.bodyToModel,
    relativeOrder: best.relativeOrder,
    meanPoseErrorDeg: Number(best.meanPoseErrorDeg.toFixed(3)),
    maxPoseErrorDeg: Number(best.maxPoseErrorDeg.toFixed(3)),
    confidence: Number((sampleConfidence * 0.35 + geometricConfidence * 0.65).toFixed(3)),
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
  if (maxAngularDeviationDeg > 4) {
    throw new Error(`姿态窗口仍在移动（最大偏差 ${maxAngularDeviationDeg.toFixed(1)}°），请稳定后重新确认`);
  }
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
  motionDirection: NonNullable<DynamicAxisCapture["motionDirection"]> = "clockwise",
  targetAngleDeg: NonNullable<DynamicAxisCapture["targetAngleDeg"]> = 90,
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
      undefined,
      motionDirection,
      targetAngleDeg,
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
    motionDirection,
    targetAngleDeg,
  );
}

function summarizeAxisVectors(
  physicalAxis: DynamicAxisCapture["physicalAxis"],
  positiveFace: CubeColor,
  vectors: readonly { x: number; y: number; z: number }[],
  sampleCount: number,
  signalSource: DynamicAxisCapture["signalSource"],
  quaternionDeltaOrder?: DynamicAxisCapture["quaternionDeltaOrder"],
  motionDirection: NonNullable<DynamicAxisCapture["motionDirection"]> = "clockwise",
  targetAngleDeg: NonNullable<DynamicAxisCapture["targetAngleDeg"]> = 90,
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
    motionDirection,
    targetAngleDeg,
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

export function summarizeCompoundMotionValidation(
  samples: readonly TimedQuaternionSample[],
  reference: CubeQuaternion,
  returnedPose: CubeQuaternion,
): CompoundMotionValidationCapture {
  if (samples.length < 20) throw new Error("自由旋转样本不足，请至少持续旋转 6 秒");
  const energy = { x: 0, y: 0, z: 0 };
  let pathRotationDeg = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = normalizeQuaternion(samples[index - 1].quaternion);
    const current = alignedTo(previous, samples[index].quaternion);
    const delta = multiplyRaw(current, conjugate(previous));
    const angle = quaternionAngularDistanceDeg(previous, current);
    if (angle < 0.05 || angle > 25) continue;
    pathRotationDeg += angle;
    energy.x += Math.abs(delta.x);
    energy.y += Math.abs(delta.y);
    energy.z += Math.abs(delta.z);
  }
  const totalEnergy = energy.x + energy.y + energy.z || 1;
  const axisCoverage = {
    x: Number((energy.x / totalEnergy).toFixed(3)),
    y: Number((energy.y / totalEnergy).toFixed(3)),
    z: Number((energy.z / totalEnergy).toFixed(3)),
  };
  const returnToReferenceErrorDeg = quaternionAngularDistanceDeg(reference, returnedPose);
  return {
    sampleCount: samples.length,
    pathRotationDeg: Number(pathRotationDeg.toFixed(1)),
    axisCoverage,
    returnToReferenceErrorDeg: Number(returnToReferenceErrorDeg.toFixed(2)),
    passed:
      pathRotationDeg >= 240 &&
      Math.min(axisCoverage.x, axisCoverage.y, axisCoverage.z) >= 0.12 &&
      returnToReferenceErrorDeg <= 10,
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
  compoundMotionValidation?: CompoundMotionValidationCapture;
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
    compoundMotionValidation: input.compoundMotionValidation,
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
