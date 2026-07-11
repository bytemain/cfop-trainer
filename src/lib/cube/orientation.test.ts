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
  const whiteUpGreenFrontFixture = {
    w: -0.5278115896786351,
    x: -0.07567134227142988,
    y: 0.018830564884244807,
    z: 0.8457743100768033,
  };
  const yellowUpBlueFrontFixture = {
    w: -0.07250381914004346,
    x: 0.843315264867377,
    y: -0.5272494414657792,
    z: 0.07463636329429311,
  };

  it("maps controlled white/green and yellow/blue captures to a model X half-turn", () => {
    const values = matrixValues(
      gyroCssTransform(yellowUpBlueFrontFixture, {
        ...DEFAULT_GYRO_CALIBRATION,
        zero: whiteUpGreenFrontFixture,
        bodyToModel: [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      }),
    );
    expect(values[0]).toBeGreaterThan(0.98);
    expect(values[5]).toBeLessThan(-0.98);
    expect(values[10]).toBeLessThan(-0.98);
  });

  it("uses the calibration pose as an identity orientation", () => {
    const values = matrixValues(
      gyroCssTransform(whiteUpGreenFrontFixture, {
        ...DEFAULT_GYRO_CALIBRATION,
        zero: whiteUpGreenFrontFixture,
      }),
    );
    expect(values.slice(0, 12)).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
    ]);
  });

  it("maps the captured red-orange whole-cube turn to the model X axis", () => {
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
    const values = matrixValues(
      gyroCssTransform(end, {
        ...DEFAULT_GYRO_CALIBRATION,
        zero: start,
        bodyToModel: [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      }),
    );
    expect(values[0]).toBeGreaterThan(0.9);
    expect(Math.abs(values[1])).toBeLessThan(0.3);
    expect(Math.abs(values[2])).toBeLessThan(0.4);
  });
});
