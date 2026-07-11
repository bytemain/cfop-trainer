import { describe, expect, it } from "vitest";
import {
  DEFAULT_GYRO_CALIBRATION,
  gyroCssTransform,
} from "./orientation";

function matrixValues(transform: string): number[] {
  const match = /^matrix3d\(([^)]+)\)/.exec(transform);
  if (!match) throw new Error(`Expected matrix3d transform, received: ${transform}`);
  return match[1].split(",").map(Number);
}

describe("GAN orientation mapping", () => {
  const yellowUpFixture = {
    x: -0.700,
    y: 0.042,
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
});
