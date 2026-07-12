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
import { Matrix, SingularValueDecomposition } from "ml-matrix";

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
  axisVector?: [number, number, number];
  sampleCount: number;
  activeSampleCount: number;
  dominance: number;
  confidence: number;
  signalSource: "angular-velocity" | "quaternion-delta";
  quaternionDeltaOrder?: "previous-inverse-current" | "current-previous-inverse";
  startPose?: StaticPoseCapture;
  endPose?: StaticPoseCapture;
  expectedEnd?: { top: CubeColor; front: CubeColor };
  layerMovesObserved?: string[];
}

export interface PoseGraphClosureCapture {
  poseKey: string;
  observationCount: number;
  maxAbsoluteErrorDeg: number;
  passed: boolean;
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
  returnTiltErrorDeg: number;
  passed: boolean;
}

export interface SignalCalibrationProfile {
  schemaVersion: 2;
  profileKind: "smart-cube-signal-calibration";
  deviceModel: string;
  protocol: GanProtocolVersion;
  createdAt: string;
  deviceIdentity: {
    model: string;
    protocol: GanProtocolVersion;
    firmwareVersion: string;
    hardwareVersion: string;
    calibrationSchema: "cube-pose-v4-pose-graph";
  };
  staticPoses: StaticPoseCapture[];
  dynamicAxes: DynamicAxisCapture[];
  moveValidation: MoveValidationCapture;
  renderValidation: RenderValidationCapture;
  compoundMotionValidation?: CompoundMotionValidationCapture;
  frameFieldEvidence: FrameFieldEvidence;
  overallConfidence: number;
  calibrationSolution?: {
    valid: boolean;
    solver: DerivedGyroCalibration["solver"];
    meanPoseErrorDeg: number;
    maxPoseErrorDeg: number;
    meanMotionEdgeErrorDeg: number;
    poseResiduals: DerivedGyroCalibration["poseResiduals"];
    rejectedPoseKeys: string[];
  };
  poseGraph?: {
    nodeCount: number;
    edgeCount: number;
    coveredTopColors: CubeColor[];
    closures: PoseGraphClosureCapture[];
  };
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
  meanMotionEdgeErrorDeg: number;
  confidence: number;
  solver: "signed-axis" | "wahba-kabsch";
  poseResiduals: Array<{ top: CubeColor; front: CubeColor; errorDeg: number; confidence: number }>;
  rejectedPoseKeys: string[];
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
    : order === "reference-inverse-current"
      ? multiplyMatrix3(transposeMatrix3(reference), current)
      : multiplyMatrix3(reference, transposeMatrix3(current));
}

function rotationVector(matrix: Matrix3): [number, number, number] | null {
  const cosine = Math.max(-1, Math.min(1, (matrix[0][0] + matrix[1][1] + matrix[2][2] - 1) / 2));
  const angle = Math.acos(cosine);
  if (angle < 3 * Math.PI / 180 || angle > 170 * Math.PI / 180) return null;
  const denominator = 2 * Math.sin(angle);
  if (Math.abs(denominator) < 1e-6) return null;
  const axis: [number, number, number] = [
    (matrix[2][1] - matrix[1][2]) / denominator,
    (matrix[0][2] - matrix[2][0]) / denominator,
    (matrix[1][0] - matrix[0][1]) / denominator,
  ];
  const length = Math.hypot(...axis);
  if (length < 1e-6) return null;
  return axis.map((value) => value / length) as [number, number, number];
}

function kabschBodyToModel(
  reference: Matrix3,
  captures: readonly StaticPoseCapture[],
  relativeOrder: SensorRelativeOrder,
): Matrix3 | null {
  const covariance = Matrix.zeros(3, 3);
  let evidence = 0;
  for (const capture of captures) {
    const sensor = relativeSensorMatrix(reference, quaternionMatrix(capture.average), relativeOrder);
    const expected = expectedCubePoseMatrix(capture.top, capture.front);
    const sensorAxis = rotationVector(sensor);
    const expectedAxis = rotationVector(expected);
    if (!sensorAxis || !expectedAxis) continue;
    const weight = Math.max(0.05, capture.confidence);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        covariance.set(row, column, covariance.get(row, column) + sensorAxis[row] * expectedAxis[column] * weight);
      }
    }
    evidence += weight;
  }
  if (evidence < 2) return null;
  const svd = new SingularValueDecomposition(covariance, { autoTranspose: true });
  const u = svd.leftSingularVectors;
  const v = svd.rightSingularVectors;
  let result = v.mmul(u.transpose());
  const resultRows = [0, 1, 2].map((row) => [0, 1, 2].map((column) => result.get(row, column))) as Matrix3;
  if (determinant3(resultRows) < 0) {
    const correction = Matrix.diag([1, 1, -1]);
    result = v.mmul(correction).mmul(u.transpose());
  }
  return [0, 1, 2].map((row) => [0, 1, 2].map((column) => result.get(row, column))) as Matrix3;
}

function scoreCalibrationCandidate(
  profile: Pick<SignalCalibrationProfile, "staticPoses" | "dynamicAxes">,
  reference: Matrix3,
  bodyToModel: Matrix3,
  relativeOrder: SensorRelativeOrder,
) {
  const poseResiduals = profile.staticPoses.map((capture) => {
    const relative = relativeSensorMatrix(reference, quaternionMatrix(capture.average), relativeOrder);
    const predicted = multiplyMatrix3(multiplyMatrix3(bodyToModel, relative), transposeMatrix3(bodyToModel));
    return {
      top: capture.top,
      front: capture.front,
      confidence: capture.confidence,
      errorDeg: rotationDistanceDeg(predicted, expectedCubePoseMatrix(capture.top, capture.front)),
    };
  });
  const totalWeight = poseResiduals.reduce((sum, item) => sum + Math.max(0.05, item.confidence), 0);
  const meanPoseErrorDeg = poseResiduals.reduce(
    (sum, item) => sum + item.errorDeg * Math.max(0.05, item.confidence), 0,
  ) / totalWeight;
  const poseGraphEdges = profile.dynamicAxes.filter((capture) =>
    capture.targetAngleDeg !== 180 && capture.startPose && capture.endPose,
  );
  const directionErrors = poseGraphEdges.length > 0
    ? poseGraphEdges.map((capture) => {
        const sensorReference = reference;
        const sensorStart = quaternionMatrix(capture.startPose!.average);
        const sensorEnd = quaternionMatrix(capture.endPose!.average);
        const predictedStart = multiplyMatrix3(
          multiplyMatrix3(
            bodyToModel,
            relativeSensorMatrix(sensorReference, sensorStart, relativeOrder),
          ),
          transposeMatrix3(bodyToModel),
        );
        const predictedEnd = multiplyMatrix3(
          multiplyMatrix3(
            bodyToModel,
            relativeSensorMatrix(sensorReference, sensorEnd, relativeOrder),
          ),
          transposeMatrix3(bodyToModel),
        );
        const predictedDelta = multiplyMatrix3(predictedEnd, transposeMatrix3(predictedStart));
        const expectedStart = expectedCubePoseMatrix(
          capture.startPose!.top,
          capture.startPose!.front,
        );
        const expectedEnd = expectedCubePoseMatrix(
          capture.endPose!.top,
          capture.endPose!.front,
        );
        const expectedDelta = multiplyMatrix3(expectedEnd, transposeMatrix3(expectedStart));
        return rotationDistanceDeg(predictedDelta, expectedDelta);
      })
    : profile.dynamicAxes.filter((capture) => capture.targetAngleDeg !== 180).map((capture) => {
        let sensorAxis = protocolAxisVector(capture);
        const captureOrder = capturedRelativeOrder(capture);
        if (captureOrder && captureOrder !== relativeOrder) {
          sensorAxis = sensorAxis.map((value) => -value) as [number, number, number];
        }
        const mapped = applyMatrix3(bodyToModel, sensorAxis);
        const expectedSign = capture.motionDirection === "counterclockwise" ? 1 : -1;
        const expected = MODEL_VECTOR_FOR_POSITIVE_FACE[capture.positiveFace]
          .map((value) => value * expectedSign);
        const dot = Math.max(-1, Math.min(1, mapped.reduce(
          (sum, value, index) => sum + value * expected[index],
          0,
        )));
        return Math.acos(dot) * 180 / Math.PI;
    });
  const meanDirectionErrorDeg = directionErrors.length
    ? directionErrors.reduce((sum, value) => sum + value, 0) / directionErrors.length
    : 180;
  return {
    bodyToModel,
    relativeOrder,
    poseResiduals,
    meanPoseErrorDeg,
    maxPoseErrorDeg: Math.max(...poseResiduals.map((item) => item.errorDeg)),
    meanDirectionErrorDeg,
    score: meanPoseErrorDeg + meanDirectionErrorDeg * 2,
  };
}

function protocolAxisVector(capture: DynamicAxisCapture): [number, number, number] {
  if (capture.axisVector) return [...capture.axisVector];
  const vector: [number, number, number] = [0, 0, 0];
  vector[AXES.indexOf(capture.protocolAxis)] = capture.sign;
  return vector;
}

export function capturedProtocolAxisVector(
  capture: DynamicAxisCapture,
): [number, number, number] {
  return protocolAxisVector(capture);
}

export function quaternionAxisTiltDeg(
  reference: CubeQuaternion,
  current: CubeQuaternion,
  sensorAxis: [number, number, number],
  deltaOrder: DynamicAxisCapture["quaternionDeltaOrder"] = "current-previous-inverse",
): number {
  const referenceMatrix = quaternionMatrix(reference);
  const currentMatrix = quaternionMatrix(current);
  const relative = deltaOrder === "previous-inverse-current"
    ? multiplyMatrix3(transposeMatrix3(referenceMatrix), currentMatrix)
    : multiplyMatrix3(currentMatrix, transposeMatrix3(referenceMatrix));
  const length = Math.hypot(...sensorAxis) || 1;
  const axis = sensorAxis.map((value) => value / length) as [number, number, number];
  const moved = applyMatrix3(relative, axis);
  const dot = Math.max(-1, Math.min(1, axis.reduce(
    (sum, value, index) => sum + value * moved[index],
    0,
  )));
  return Math.acos(dot) * 180 / Math.PI;
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

  if (profile.staticPoses.length < 3) return null;
  const hasPoseGraphEdges = profile.dynamicAxes.some((capture) =>
    capture.targetAngleDeg !== 180 && capture.startPose && capture.endPose,
  );
  if (!hasPoseGraphEdges) {
    if (profile.dynamicAxes.length < 3) return null;
    const independentAxes = ["red-orange", "blue-green", "white-yellow"].map((physicalAxis) =>
      profile.dynamicAxes.find((capture) =>
        capture.physicalAxis === physicalAxis && capture.targetAngleDeg !== 180,
      ),
    );
    if (independentAxes.some((capture) => !capture)) return null;
    const axisVectors = independentAxes.map((capture) => protocolAxisVector(capture!));
    const axisEvidenceDeterminant = Math.abs(determinant3(axisVectors as Matrix3));
    // Legacy axis-only profiles still need three independent vectors. Pose
    // Graph profiles use the complete start/end SO(3) deltas instead.
    if (axisEvidenceDeterminant < 0.15) return null;
  }
  const reference = quaternionMatrix(zeroCapture.average);
  const discreteCandidates = properAxisRotations().flatMap((bodyToModel) =>
    SENSOR_RELATIVE_ORDERS.map((relativeOrder) => ({
      ...scoreCalibrationCandidate(profile, reference, bodyToModel, relativeOrder),
      solver: "signed-axis" as const,
    })),
  );
  const continuousCandidates = SENSOR_RELATIVE_ORDERS.flatMap((relativeOrder) => {
    const bodyToModel = kabschBodyToModel(reference, profile.staticPoses, relativeOrder);
    return bodyToModel ? [{
      ...scoreCalibrationCandidate(profile, reference, bodyToModel, relativeOrder),
      solver: "wahba-kabsch" as const,
    }] : [];
  });
  const candidates = [...discreteCandidates, ...continuousCandidates].sort((left, right) => left.score - right.score);
  const best = candidates[0];
  if (!best) return null;
  const sampleConfidence = [
    ...profile.staticPoses.map((capture) => capture.confidence),
    ...profile.dynamicAxes.map((capture) => capture.confidence),
  ].reduce((sum, value) => sum + value, 0) / (profile.staticPoses.length + profile.dynamicAxes.length);
  const geometricConfidence = Math.max(0, 1 - best.meanPoseErrorDeg / 45);
  const coveredTopColorCount = new Set(profile.staticPoses.map((capture) => capture.top)).size;
  return {
    valid:
      coveredTopColorCount === 6 &&
      best.meanPoseErrorDeg <= 10 &&
      best.maxPoseErrorDeg <= 20 &&
      best.meanDirectionErrorDeg <= 15,
    zero: { ...zeroCapture.average },
    bodyToModel: best.bodyToModel,
    relativeOrder: best.relativeOrder,
    meanPoseErrorDeg: Number(best.meanPoseErrorDeg.toFixed(3)),
    maxPoseErrorDeg: Number(best.maxPoseErrorDeg.toFixed(3)),
    meanMotionEdgeErrorDeg: Number(best.meanDirectionErrorDeg.toFixed(3)),
    confidence: Number((sampleConfidence * 0.35 + geometricConfidence * 0.65).toFixed(3)),
    solver: best.solver,
    poseResiduals: best.poseResiduals.map((item) => ({ ...item, errorDeg: Number(item.errorDeg.toFixed(3)) })),
    rejectedPoseKeys: best.poseResiduals
      .filter((item) => item.errorDeg > Math.max(12, best.meanPoseErrorDeg * 1.8))
      .map((item) => `${item.top}/${item.front}`),
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

export function validatePoseGraphEdgeEndpoint(input: {
  startPose: StaticPoseCapture;
  endPose: StaticPoseCapture;
  targetAngleDeg: 90 | 180;
  layerMovesObserved: readonly string[];
}): { endpointAngleDeg: number; toleranceDeg: number } {
  if (input.layerMovesObserved.length > 0) {
    throw new Error(`检测到层转 ${input.layerMovesObserved.join(" ")}；这条边已污染，请停止并重采，不要拧任何单独一层`);
  }
  const endpointAngleDeg = quaternionAngularDistanceDeg(
    input.startPose.average,
    input.endPose.average,
  );
  const toleranceDeg = input.targetAngleDeg === 180 ? 25 : 18;
  if (Math.abs(endpointAngleDeg - input.targetAngleDeg) > toleranceDeg) {
    throw new Error(`终点与目标 ${input.targetAngleDeg}° 相差过大（当前 ${endpointAngleDeg.toFixed(1)}°）；请继续调整到示意终点并停稳`);
  }
  return { endpointAngleDeg, toleranceDeg };
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
  const sampleDurationMs = Math.max(0, samples.at(-1)!.at - samples[0].at);
  // GAN16 V4 is typically around 11.4 Hz. Confidence follows the actual
  // stable time span instead of an impossible 24-sample target in 1.2 s.
  const coverage = Math.min(1, sampleDurationMs / 900);
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
  const averageVector: [number, number, number] = [signed.x, signed.y, signed.z];
  const averageLength = Math.hypot(...averageVector) || 1;
  return {
    physicalAxis,
    positiveFace,
    motionDirection,
    targetAngleDeg,
    protocolAxis,
    sign: signed[protocolAxis] < 0 ? -1 : 1,
    axisVector: averageVector.map((value) => value / averageLength) as [number, number, number],
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
      const gapMs = samples[index].at - samples[index - 1].at;
      if (gapMs <= 0 || gapMs > 500 || stepAngle < 0.08 || stepAngle > 75) continue;
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
  returnTiltErrorDeg?: number,
  calibration?: Pick<DerivedGyroCalibration, "bodyToModel" | "relativeOrder">,
): CompoundMotionValidationCapture {
  if (samples.length < 20) throw new Error("自由旋转样本不足，请至少持续旋转 6 秒");
  const energy = { x: 0, y: 0, z: 0 };
  let pathRotationDeg = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = normalizeQuaternion(samples[index - 1].quaternion);
    const current = alignedTo(previous, samples[index].quaternion);
    const delta = calibration?.relativeOrder === "reference-current-inverse"
      ? multiplyRaw(previous, conjugate(current))
      : multiplyRaw(current, conjugate(previous));
    const angle = quaternionAngularDistanceDeg(previous, current);
    const gapMs = samples[index].at - samples[index - 1].at;
    if (gapMs <= 0 || gapMs > 500 || angle < 0.05 || angle > 75) continue;
    pathRotationDeg += angle;
    const vector = calibration
      ? applyMatrix3(calibration.bodyToModel, [delta.x, delta.y, delta.z])
      : [delta.x, delta.y, delta.z];
    energy.x += Math.abs(vector[0]);
    energy.y += Math.abs(vector[1]);
    energy.z += Math.abs(vector[2]);
  }
  const totalEnergy = energy.x + energy.y + energy.z || 1;
  const axisCoverage = {
    x: Number((energy.x / totalEnergy).toFixed(3)),
    y: Number((energy.y / totalEnergy).toFixed(3)),
    z: Number((energy.z / totalEnergy).toFixed(3)),
  };
  const returnToReferenceErrorDeg = quaternionAngularDistanceDeg(reference, returnedPose);
  const resolvedTiltErrorDeg = returnTiltErrorDeg ?? returnToReferenceErrorDeg;
  return {
    sampleCount: samples.length,
    pathRotationDeg: Number(pathRotationDeg.toFixed(1)),
    axisCoverage,
    returnToReferenceErrorDeg: Number(returnToReferenceErrorDeg.toFixed(2)),
    returnTiltErrorDeg: Number(resolvedTiltErrorDeg.toFixed(2)),
    passed:
      pathRotationDeg >= 240 &&
      Math.min(axisCoverage.x, axisCoverage.y, axisCoverage.z) >= 0.12 &&
      resolvedTiltErrorDeg <= 12,
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
  firmwareVersion?: string;
  hardwareVersion?: string;
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
  const calibration = deriveGyroCalibrationFromSignalProfile({
    staticPoses: input.staticPoses,
    dynamicAxes: input.dynamicAxes,
  });
  const poseObservations = new Map<string, StaticPoseCapture[]>();
  for (const capture of input.dynamicAxes) {
    for (const pose of [capture.startPose, capture.endPose]) {
      if (!pose) continue;
      const key = `${pose.top}/${pose.front}`;
      poseObservations.set(key, [...(poseObservations.get(key) ?? []), pose]);
    }
  }
  const closures: PoseGraphClosureCapture[] = [...poseObservations.entries()]
    .filter(([, observations]) => observations.length > 1)
    .map(([poseKey, observations]) => {
      let maxAbsoluteErrorDeg = 0;
      for (let left = 0; left < observations.length; left += 1) {
        for (let right = left + 1; right < observations.length; right += 1) {
          maxAbsoluteErrorDeg = Math.max(
            maxAbsoluteErrorDeg,
            quaternionAngularDistanceDeg(observations[left].average, observations[right].average),
          );
        }
      }
      return {
        poseKey,
        observationCount: observations.length,
        maxAbsoluteErrorDeg: Number(maxAbsoluteErrorDeg.toFixed(3)),
        passed: maxAbsoluteErrorDeg <= 15,
      };
    });
  return {
    schemaVersion: 2,
    profileKind: "smart-cube-signal-calibration",
    deviceModel: input.deviceModel,
    protocol: input.protocol,
    createdAt: (input.now ?? new Date()).toISOString(),
    deviceIdentity: {
      model: input.deviceModel,
      protocol: input.protocol,
      firmwareVersion: input.firmwareVersion ?? "unknown",
      hardwareVersion: input.hardwareVersion ?? "unknown",
      calibrationSchema: "cube-pose-v4-pose-graph",
    },
    staticPoses: input.staticPoses,
    dynamicAxes: input.dynamicAxes,
    moveValidation: input.moveValidation,
    renderValidation: input.renderValidation,
    compoundMotionValidation: input.compoundMotionValidation,
    frameFieldEvidence: input.frameFieldEvidence,
    overallConfidence: Number(overallConfidence.toFixed(3)),
    calibrationSolution: calibration ? {
      valid: calibration.valid,
      solver: calibration.solver,
      meanPoseErrorDeg: calibration.meanPoseErrorDeg,
      maxPoseErrorDeg: calibration.maxPoseErrorDeg,
      meanMotionEdgeErrorDeg: calibration.meanMotionEdgeErrorDeg,
      poseResiduals: calibration.poseResiduals,
      rejectedPoseKeys: calibration.rejectedPoseKeys,
    } : undefined,
    poseGraph: {
      nodeCount: input.staticPoses.length,
      edgeCount: input.dynamicAxes.filter((capture) => capture.startPose && capture.endPose).length,
      coveredTopColors: [...new Set(input.staticPoses.map((capture) => capture.top))].sort(),
      closures,
    },
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
