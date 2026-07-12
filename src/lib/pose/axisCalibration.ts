import { Matrix, SingularValueDecomposition } from "ml-matrix";
import { applyMatrix3, type Matrix3 } from "$lib/cube/orientation";

export type LearnedBodyAxes = Record<"x" | "y" | "z", { x: number; y: number; z: number }>;

export interface AxisCalibrationSolution {
  bodyToModel: Matrix3;
  meanAxisErrorDeg: number;
  maxAxisErrorDeg: number;
  evidenceDeterminant: number;
}

const MODEL_AXES: Record<"x" | "y" | "z", [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function normalize(value: { x: number; y: number; z: number }): [number, number, number] | null {
  const length = Math.hypot(value.x, value.y, value.z);
  return length < 1e-6 ? null : [value.x / length, value.y / length, value.z / length];
}

function determinant3(matrix: Matrix3): number {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

function angleDeg(left: [number, number, number], right: [number, number, number]): number {
  const dot = Math.max(-1, Math.min(1, left[0] * right[0] + left[1] * right[1] + left[2] * right[2]));
  return Math.acos(dot) * 180 / Math.PI;
}

export function solveBodyAxisCalibration(
  axes: Partial<LearnedBodyAxes>,
): AxisCalibrationSolution | null {
  const keys = ["x", "y", "z"] as const;
  const sensorAxes = keys.map((key) => axes[key] ? normalize(axes[key]!) : null);
  if (sensorAxes.some((axis) => !axis)) return null;
  const sensor = sensorAxes as Array<[number, number, number]>;
  const evidenceMatrix: Matrix3 = [
    [sensor[0][0], sensor[1][0], sensor[2][0]],
    [sensor[0][1], sensor[1][1], sensor[2][1]],
    [sensor[0][2], sensor[1][2], sensor[2][2]],
  ];
  const evidenceDeterminant = determinant3(evidenceMatrix);
  if (Math.abs(evidenceDeterminant) < 0.2) return null;

  const covariance = Matrix.zeros(3, 3);
  for (let index = 0; index < 3; index += 1) {
    const expected = MODEL_AXES[keys[index]];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        covariance.set(row, column, covariance.get(row, column) + sensor[index][row] * expected[column]);
      }
    }
  }
  const svd = new SingularValueDecomposition(covariance, { autoTranspose: true });
  const u = svd.leftSingularVectors;
  const v = svd.rightSingularVectors;
  let result = v.mmul(u.transpose());
  let rows = [0, 1, 2].map((row) => [0, 1, 2].map((column) => result.get(row, column))) as Matrix3;
  if (determinant3(rows) < 0) {
    result = v.mmul(Matrix.diag([1, 1, -1])).mmul(u.transpose());
    rows = [0, 1, 2].map((row) => [0, 1, 2].map((column) => result.get(row, column))) as Matrix3;
  }
  const errors = keys.map((key, index) => angleDeg(applyMatrix3(rows, sensor[index]), MODEL_AXES[key]));
  const meanAxisErrorDeg = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const maxAxisErrorDeg = Math.max(...errors);
  if (meanAxisErrorDeg > 15 || maxAxisErrorDeg > 25) return null;
  return {
    bodyToModel: rows,
    meanAxisErrorDeg: Number(meanAxisErrorDeg.toFixed(3)),
    maxAxisErrorDeg: Number(maxAxisErrorDeg.toFixed(3)),
    evidenceDeterminant: Number(evidenceDeterminant.toFixed(6)),
  };
}
