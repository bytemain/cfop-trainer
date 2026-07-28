import type { CubeQuaternion } from "$lib/protocols/gan/types";
import {
  Matrix3 as ThreeMatrix3,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";

export interface GyroCalibration {
  modelVersion: 2;
  enabled: boolean;
  zero: CubeQuaternion | null;
  bodyToModel: Matrix3 | null;
  relativeOrder: SensorRelativeOrder;
  meanPoseErrorDeg: number | null;
  maxPoseErrorDeg?: number | null;
  referencePose?: Matrix3 | null;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
}

export interface DeviceCalibration {
  schemaVersion: 3;
  enabled: boolean;
  bodyToModel: Matrix3 | null;
  relativeOrder: SensorRelativeOrder;
  meanPoseErrorDeg: number | null;
  maxPoseErrorDeg: number | null;
}

export interface SessionAnchor {
  sensorReference: CubeQuaternion;
  cubeReference: Matrix3;
  establishedAt: number;
  reason: "calibration" | "manual" | "session-start" | "sensor-reset";
}

export interface ViewPreference {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
}

export type SensorRelativeOrder =
  | "current-reference-inverse"
  | "reference-current-inverse";

export type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

// Fixed GAN V4 protocol contract confirmed by CubeStation's Android bridge,
// csTimer-compatible packet semantics and controlled GAN16ui rotations.
// Canonical cube space is +X red, +Y white, +Z green.
//
// bodyToModel is the signed-axis sensor mounting (sensor +X -> model +Z,
// +Y -> model -X, +Z -> model -Y). With relativeOrder reference * inverse(current),
// the conjugation bodyToModel * delta * bodyToModel^T maps a physical
// whole-cube turn onto the same model axis with the physical direction;
// orientation.test.ts locks this with deidentified GAN16ui fixtures.
export const GAN_V4_BODY_TO_MODEL: Matrix3 = [[0, -1, 0], [0, 0, -1], [1, 0, 0]];
export const GAN_V4_RELATIVE_ORDER: SensorRelativeOrder = "reference-current-inverse";
export const GAN_V4_POSE_CONTRACT_VERSION = 1;

// Deidentified GAN16ui real-device reading at the canonical identity grip
// (white up, green front). Fixture evidence for the axis contract only: the
// sensor world frame origin is session-dependent, so this constant must not
// be used as a cross-session absolute reference at runtime. Sessions anchor
// relative tracking at the first pose frame; quick calibration performs the
// explicit semantic binding to canonical identity.
export const GAN_V4_IDENTITY_SENSOR_POSE: CubeQuaternion = {
  x: -0.07567134227142988,
  y: 0.018830564884244807,
  z: 0.8457743100768033,
  w: -0.5278115896786351,
};

export const GAN_V4_SENSOR_AXES: Record<"x" | "y" | "z", [number, number, number]> = {
  x: [0, -1, 0],
  y: [0, 0, -1],
  z: [1, 0, 0],
};

export const DEFAULT_GYRO_CALIBRATION: GyroCalibration = {
  modelVersion: 2,
  enabled: true,
  zero: null,
  bodyToModel: null,
  relativeOrder: GAN_V4_RELATIVE_ORDER,
  meanPoseErrorDeg: null,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  invertX: false,
  invertY: false,
  invertZ: false,
};

export const DEFAULT_DEVICE_CALIBRATION: DeviceCalibration = {
  schemaVersion: 3,
  enabled: true,
  bodyToModel: GAN_V4_BODY_TO_MODEL,
  relativeOrder: GAN_V4_RELATIVE_ORDER,
  meanPoseErrorDeg: null,
  maxPoseErrorDeg: null,
};

export const DEFAULT_VIEW_PREFERENCE: ViewPreference = {
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  invertX: false,
  invertY: false,
  invertZ: false,
};

/**
 * Axis inversions and Euler offsets were previously used to compensate for an
 * incomplete GAN V4 pose model. They are display preferences in the current
 * SSOT, so keep values written by the current contract but discard unversioned
 * legacy compensation once when a GAN V4 device reconnects.
 */
export function migrateGanV4ViewPreference(
  poseContractVersion: number | undefined,
  preference: ViewPreference,
): { preference: ViewPreference; migrated: boolean } {
  if ((poseContractVersion ?? 0) >= GAN_V4_POSE_CONTRACT_VERSION) {
    return { preference, migrated: false };
  }
  return { preference: { ...DEFAULT_VIEW_PREFERENCE }, migrated: true };
}

export function composeGyroCalibration(
  device: DeviceCalibration,
  anchor: SessionAnchor | null,
  view: ViewPreference,
): GyroCalibration {
  return {
    modelVersion: 2,
    enabled: device.enabled,
    zero: anchor?.sensorReference ?? null,
    referencePose: anchor?.cubeReference ?? null,
    bodyToModel: device.bodyToModel,
    relativeOrder: device.relativeOrder,
    meanPoseErrorDeg: device.meanPoseErrorDeg,
    maxPoseErrorDeg: device.maxPoseErrorDeg,
    ...view,
  };
}

export function normalizeQuaternion(value: CubeQuaternion): CubeQuaternion {
  const quaternion = new Quaternion(value.x, value.y, value.z, value.w).normalize();
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

export function multiplyQuaternions(
  left: CubeQuaternion,
  right: CubeQuaternion,
): CubeQuaternion {
  const result = new Quaternion().multiplyQuaternions(
    new Quaternion(left.x, left.y, left.z, left.w).normalize(),
    new Quaternion(right.x, right.y, right.z, right.w).normalize(),
  ).normalize();
  return { x: result.x, y: result.y, z: result.z, w: result.w };
}

export function quaternionFromAxisAngle(
  axis: "x" | "y" | "z",
  degrees: number,
): CubeQuaternion {
  const direction = axis === "x"
    ? new Vector3(1, 0, 0)
    : axis === "y"
      ? new Vector3(0, 1, 0)
      : new Vector3(0, 0, 1);
  const result = new Quaternion().setFromAxisAngle(direction, degrees * Math.PI / 180);
  return { x: result.x, y: result.y, z: result.z, w: result.w };
}

export function quaternionMatrix(q: CubeQuaternion): Matrix3 {
  const normalized = new Quaternion(q.x, q.y, q.z, q.w).normalize();
  return rowsFromThreeMatrix3(
    new ThreeMatrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(normalized)),
  );
}

function threeMatrix3FromRows(value: Matrix3): ThreeMatrix3 {
  return new ThreeMatrix3().set(
    value[0][0], value[0][1], value[0][2],
    value[1][0], value[1][1], value[1][2],
    value[2][0], value[2][1], value[2][2],
  );
}

function rowsFromThreeMatrix3(value: ThreeMatrix3): Matrix3 {
  const elements = value.elements;
  return [
    [elements[0], elements[3], elements[6]],
    [elements[1], elements[4], elements[7]],
    [elements[2], elements[5], elements[8]],
  ];
}

export function transposeMatrix3(value: Matrix3): Matrix3 {
  return rowsFromThreeMatrix3(threeMatrix3FromRows(value).transpose());
}

export function multiplyMatrix3(left: Matrix3, right: Matrix3): Matrix3 {
  return rowsFromThreeMatrix3(
    new ThreeMatrix3().multiplyMatrices(
      threeMatrix3FromRows(left),
      threeMatrix3FromRows(right),
    ),
  );
}

export function applyMatrix3(matrix: Matrix3, vector: [number, number, number]): [number, number, number] {
  const result = new Vector3(...vector).applyMatrix3(threeMatrix3FromRows(matrix));
  return [result.x, result.y, result.z];
}

export function rotationDistanceDeg(left: Matrix3, right: Matrix3): number {
  const delta = multiplyMatrix3(left, transposeMatrix3(right));
  const cosine = Math.max(-1, Math.min(1, (delta[0][0] + delta[1][1] + delta[2][2] - 1) / 2));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function gyroModelMatrix(
  quaternion: CubeQuaternion | null,
  calibration: GyroCalibration,
): Matrix3 | null {
  if (!quaternion || !calibration.enabled) return null;
  if (!calibration.zero) {
    // Before the session anchor exists there is no reproducible absolute
    // reference (the sensor world frame origin is session-dependent), so
    // render the canonical grip. The first pose frame anchors relative
    // tracking; quick calibration binds semantic identity explicitly.
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  }
  const current = quaternionMatrix(quaternion);
  const bodyToModel = calibration.bodyToModel ?? GAN_V4_BODY_TO_MODEL;
  const reference = quaternionMatrix(calibration.zero);
  const relative = calibration.relativeOrder === "current-reference-inverse"
    ? multiplyMatrix3(current, transposeMatrix3(reference))
    : multiplyMatrix3(reference, transposeMatrix3(current));
  const relativePose = multiplyMatrix3(
    multiplyMatrix3(bodyToModel as Matrix3, relative),
    transposeMatrix3(bodyToModel as Matrix3),
  );
  // The relative pose is the complete rotation from the anchor grip expressed
  // in the model world frame; it right-multiplies whatever canonical pose the
  // anchor represents (identity for quick calibration and session start, the
  // last accepted pose after a sensor reset).
  let model = calibration.referencePose
    ? multiplyMatrix3(calibration.referencePose, relativePose)
    : relativePose;
  const signs = [calibration.invertX ? -1 : 1, calibration.invertY ? -1 : 1, calibration.invertZ ? -1 : 1];
  const inversion = [[signs[0], 0, 0], [0, signs[1], 0], [0, 0, signs[2]]];
  model = multiplyMatrix3(multiplyMatrix3(inversion as Matrix3, model), inversion as Matrix3);
  return model;
}
