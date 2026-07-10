import type { CubeQuaternion } from "$lib/protocols/gan/types";

export interface GyroCalibration {
  enabled: boolean;
  zero: CubeQuaternion | null;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
}

export const DEFAULT_GYRO_CALIBRATION: GyroCalibration = {
  enabled: true,
  zero: null,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  invertX: false,
  invertY: false,
  invertZ: false,
};

export function normalizeQuaternion(value: CubeQuaternion): CubeQuaternion {
  const length = Math.hypot(value.x, value.y, value.z, value.w) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length };
}

function multiply(left: CubeQuaternion, right: CubeQuaternion): CubeQuaternion {
  return normalizeQuaternion({
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  });
}

function relativeQuaternion(current: CubeQuaternion, zero: CubeQuaternion | null): CubeQuaternion {
  const value = normalizeQuaternion(current);
  if (!zero) return value;
  const origin = normalizeQuaternion(zero);
  return multiply({ x: -origin.x, y: -origin.y, z: -origin.z, w: origin.w }, value);
}

function quaternionMatrix(q: CubeQuaternion): number[][] {
  const { x, y, z, w } = normalizeQuaternion(q);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function transpose(value: number[][]): number[][] {
  return value[0].map((_, column) => value.map((row) => row[column]));
}

function matrixMultiply(left: number[][], right: number[][]): number[][] {
  return left.map((row) =>
    right[0].map((_, column) => row.reduce((sum, value, index) => sum + value * right[index][column], 0)),
  );
}

export function gyroCssTransform(
  quaternion: CubeQuaternion | null,
  calibration: GyroCalibration,
): string {
  if (!quaternion || !calibration.enabled) return "";
  const protocol = quaternionMatrix(relativeQuaternion(quaternion, calibration.zero));
  // GAN right-handed axes: +X red, +Y blue, +Z white.
  // UI cube axes: +X red, +Y white, +Z green, hence model = (x, z, -y).
  const coordinates = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  let model = matrixMultiply(matrixMultiply(coordinates, protocol), transpose(coordinates));
  const signs = [calibration.invertX ? -1 : 1, calibration.invertY ? -1 : 1, calibration.invertZ ? -1 : 1];
  const inversion = [[signs[0], 0, 0], [0, signs[1], 0], [0, 0, signs[2]]];
  model = matrixMultiply(matrixMultiply(inversion, model), inversion);
  const values = [
    model[0][0], model[1][0], model[2][0], 0,
    model[0][1], model[1][1], model[2][1], 0,
    model[0][2], model[1][2], model[2][2], 0,
    0, 0, 0, 1,
  ].map((value) => Math.abs(value) < 1e-8 ? 0 : Number(value.toFixed(7)));
  return `matrix3d(${values.join(",")}) rotateX(${calibration.offsetX}deg) rotateY(${calibration.offsetY}deg) rotateZ(${calibration.offsetZ}deg)`;
}
