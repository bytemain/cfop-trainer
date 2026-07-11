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

export const DEFAULT_GYRO_CALIBRATION: GyroCalibration = {
  modelVersion: 2,
  enabled: true,
  zero: null,
  bodyToModel: null,
  relativeOrder: "reference-current-inverse",
  meanPoseErrorDeg: null,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  invertX: false,
  invertY: false,
  invertZ: false,
};

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

function matrixCssTransform(model: number[][]): string {
  const values = new Matrix4().set(
    model[0][0], model[0][1], model[0][2], 0,
    model[1][0], model[1][1], model[1][2], 0,
    model[2][0], model[2][1], model[2][2], 0,
    0, 0, 0, 1,
  ).elements.map((value) => Math.abs(value) < 1e-8 ? 0 : Number(value.toFixed(7)));
  return `matrix3d(${values.join(",")})`;
}

// Canonical cube space is right-handed: +X red, +Y white, +Z green.
// CSS uses +Y down, and the DOM cube's U face therefore has normal -Y.
// Convert both the input and output bases at the renderer boundary; protocol
// and calibration code must never know about this reflection.
const CUBE_TO_CSS_FRAME: Matrix3 = [[1, 0, 0], [0, -1, 0], [0, 0, 1]];

export function cubePoseToCssMatrix(cubePose: Matrix3): Matrix3 {
  return multiplyMatrix3(
    multiplyMatrix3(CUBE_TO_CSS_FRAME, cubePose),
    CUBE_TO_CSS_FRAME,
  );
}

export function quaternionCssTransform(quaternion: CubeQuaternion): string {
  return matrixCssTransform(quaternionMatrix(quaternion));
}

export function gyroCssTransform(
  quaternion: CubeQuaternion | null,
  calibration: GyroCalibration,
): string {
  const model = gyroModelMatrix(quaternion, calibration);
  if (!model) return "";
  return `${matrixCssTransform(cubePoseToCssMatrix(model))} rotateX(${calibration.offsetX}deg) rotateY(${calibration.offsetY}deg) rotateZ(${calibration.offsetZ}deg)`;
}

export function gyroModelMatrix(
  quaternion: CubeQuaternion | null,
  calibration: GyroCalibration,
): Matrix3 | null {
  if (!quaternion || !calibration.enabled) return null;
  const current = quaternionMatrix(quaternion);
  // The signal lab derives this signed permutation independently for each
  // physical cube. Until calibration is complete, retain the protocol's
  // conservative legacy fallback so gyro rendering remains usable.
  const bodyToModel = calibration.bodyToModel ?? [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const ganWorldToUiWorld: Matrix3 = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]];
  let model: Matrix3;
  if (calibration.zero) {
    const reference = quaternionMatrix(calibration.zero);
    const relative = calibration.relativeOrder === "current-reference-inverse"
      ? multiplyMatrix3(current, transposeMatrix3(reference))
      : multiplyMatrix3(reference, transposeMatrix3(current));
    model = multiplyMatrix3(
      multiplyMatrix3(bodyToModel as Matrix3, relative),
      transposeMatrix3(bodyToModel as Matrix3),
    );
  } else {
    // UI model body -> GAN body -> GAN world -> UI world.
    model = multiplyMatrix3(
      multiplyMatrix3(ganWorldToUiWorld, transposeMatrix3(current)),
      transposeMatrix3(bodyToModel as Matrix3),
    );
  }
  const signs = [calibration.invertX ? -1 : 1, calibration.invertY ? -1 : 1, calibration.invertZ ? -1 : 1];
  const inversion = [[signs[0], 0, 0], [0, signs[1], 0], [0, 0, signs[2]]];
  model = multiplyMatrix3(multiplyMatrix3(inversion as Matrix3, model), inversion as Matrix3);
  return model;
}
