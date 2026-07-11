import { describe, expect, it } from "vitest";
import { DEFAULT_GYRO_CALIBRATION } from "$lib/cube/orientation";
import { SOLVED_COLORS } from "$lib/cube/cube";
import { recognizeCubePose } from "./poseRecognition";

describe("calibration pose recognition", () => {
  const reference = { x: -0.7, y: 0.042, z: -0.711, w: -0.047 };

  it("recognizes the calibrated identity as white up and green front", () => {
    const pose = recognizeCubePose(
      reference,
      { ...DEFAULT_GYRO_CALIBRATION, zero: reference },
      SOLVED_COLORS,
    );
    expect(pose).toMatchObject({
      topFace: "U",
      frontFace: "F",
      topColor: "white",
      frontColor: "green",
      confident: true,
    });
  });

  it("does not claim a pose when gyro following is disabled", () => {
    expect(recognizeCubePose(
      reference,
      { ...DEFAULT_GYRO_CALIBRATION, enabled: false },
      SOLVED_COLORS,
    )).toBeNull();
  });
});
