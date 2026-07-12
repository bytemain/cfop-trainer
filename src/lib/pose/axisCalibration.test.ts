import { describe, expect, it } from "vitest";
import { applyMatrix3, transposeMatrix3, type Matrix3 } from "$lib/cube/orientation";
import { solveBodyAxisCalibration } from "./axisCalibration";

describe("body-axis calibration", () => {
  it("recovers a non-axis-aligned sensor mounting from three physical axes", () => {
    const bodyToModel: Matrix3 = [
      [0.36, -0.48, 0.8],
      [0.8, 0.6, 0],
      [-0.48, 0.64, 0.6],
    ];
    const modelToBody = transposeMatrix3(bodyToModel);
    const x = applyMatrix3(modelToBody, [1, 0, 0]);
    const y = applyMatrix3(modelToBody, [0, 1, 0]);
    const z = applyMatrix3(modelToBody, [0, 0, 1]);
    const solution = solveBodyAxisCalibration({
      x: { x: x[0], y: x[1], z: x[2] },
      y: { x: y[0], y: y[1], z: y[2] },
      z: { x: z[0], y: z[1], z: z[2] },
    });
    expect(solution?.meanAxisErrorDeg).toBeCloseTo(0, 5);
    expect(solution?.bodyToModel).toEqual(bodyToModel.map((row) => row.map((value) => expect.closeTo(value, 5))));
  });

  it("rejects three collapsed observations that cannot define a basis", () => {
    expect(solveBodyAxisCalibration({
      x: { x: 1, y: 0, z: 0 },
      y: { x: 0.99, y: 0.01, z: 0 },
      z: { x: 1, y: 0, z: 0.01 },
    })).toBeNull();
  });
});
