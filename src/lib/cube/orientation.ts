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

export function multiplyQuaternions(
  left: CubeQuaternion,
  right: CubeQuaternion,
): CubeQuaternion {
  return normalizeQuaternion({
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  });
}

export function quaternionFromAxisAngle(
  axis: "x" | "y" | "z",
  degrees: number,
): CubeQuaternion {
  const halfAngle = degrees * Math.PI / 360;
  const sine = Math.sin(halfAngle);
  return normalizeQuaternion({
    x: axis === "x" ? sine : 0,
    y: axis === "y" ? sine : 0,
    z: axis === "z" ? sine : 0,
    w: Math.cos(halfAngle),
  });
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

function matrixCssTransform(model: number[][]): string {
  const values = [
    model[0][0], model[1][0], model[2][0], 0,
    model[0][1], model[1][1], model[2][1], 0,
    model[0][2], model[1][2], model[2][2], 0,
    0, 0, 0, 1,
  ].map((value) => Math.abs(value) < 1e-8 ? 0 : Number(value.toFixed(7)));
  return `matrix3d(${values.join(",")})`;
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
  return `${matrixCssTransform(model)} rotateX(${calibration.offsetX}deg) rotateY(${calibration.offsetY}deg) rotateZ(${calibration.offsetZ}deg)`;
}

export function gyroModelMatrix(
  quaternion: CubeQuaternion | null,
  calibration: GyroCalibration,
): number[][] | null {
  if (!quaternion || !calibration.enabled) return null;
  const current = quaternionMatrix(quaternion);
  // CubeStation's reordered GAN quaternion is cube-body -> GAN-world. The cube body uses +X red,
  // +Y blue and +Z white, while the UI model uses +X red, +Y white and
  // +Z green. GAN's gravity-aligned world frame has -X pointing up.
  const bodyToModel = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const ganWorldToUiWorld = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];
  let model: number[][];
  if (calibration.zero) {
    // Calibrated body -> current body. At the calibration pose this is identity.
    const relative = matrixMultiply(
      transpose(quaternionMatrix(calibration.zero)),
      current,
    );
    model = matrixMultiply(
      matrixMultiply(bodyToModel, relative),
      transpose(bodyToModel),
    );
  } else {
    // UI model body -> GAN body -> GAN world -> UI world.
    model = matrixMultiply(
      matrixMultiply(ganWorldToUiWorld, current),
      transpose(bodyToModel),
    );
  }
  const signs = [calibration.invertX ? -1 : 1, calibration.invertY ? -1 : 1, calibration.invertZ ? -1 : 1];
  const inversion = [[signs[0], 0, 0], [0, signs[1], 0], [0, 0, signs[2]]];
  model = matrixMultiply(matrixMultiply(inversion, model), inversion);
  return model;
}
