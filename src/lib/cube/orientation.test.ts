import { describe, expect, it } from "vitest";
import {
  DEFAULT_GYRO_CALIBRATION,
  gyroCssTransform,
  multiplyQuaternions,
} from "./orientation";

function matrixValues(transform: string): number[] {
  const match = /^matrix3d\(([^)]+)\)/.exec(transform);
  if (!match) throw new Error(`Expected matrix3d transform, received: ${transform}`);
  return match[1].split(",").map(Number);
}

describe("GAN orientation mapping", () => {
  const yellowUpFixture = {
    x: 0.042,
    y: -0.700,
    z: -0.711,
    w: -0.047,
  };

  it("maps the captured yellow-up GAN16 pose to yellow up in the UI", () => {
    const values = matrixValues(
      gyroCssTransform(yellowUpFixture, DEFAULT_GYRO_CALIBRATION),
    );
    // The UI model's white normal is +Y, represented by matrix column 2.
    // With yellow physically up, white must point down in UI world space.
    expect(values[5]).toBeLessThan(-0.95);
  });

  it("uses the calibration pose as an identity orientation", () => {
    const values = matrixValues(
      gyroCssTransform(yellowUpFixture, {
        ...DEFAULT_GYRO_CALIBRATION,
        zero: yellowUpFixture,
      }),
    );
    expect(values.slice(0, 12)).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
    ]);
  });

  it("maps the captured red-orange whole-cube turn to the semantic X body axis", () => {
    const start = {
      x: -0.000946073793755913,
      y: -0.002044740134891812,
      z: -0.6023743400372326,
      w: 0.7981810968352305,
    };
    const end = {
      x: 0.6464430677205725,
      y: -0.6256904812768944,
      z: -0.3562425611133152,
      w: 0.2522965178380688,
    };
    const relative = multiplyQuaternions(
      { x: -start.x, y: -start.y, z: -start.z, w: start.w },
      end,
    );
    expect(Math.abs(relative.x)).toBeGreaterThan(0.85);
    expect(Math.abs(relative.x)).toBeGreaterThan(Math.abs(relative.y) * 5);
    expect(Math.abs(relative.x)).toBeGreaterThan(Math.abs(relative.z) * 5);
  });
});
