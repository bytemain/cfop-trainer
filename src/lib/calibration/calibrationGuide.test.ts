import { describe, expect, it } from "vitest";
import { createDynamicGuideModel } from "./calibrationGuide";

describe("dynamic tabletop calibration guide", () => {
  it("shows red up rotating clockwise around the red-orange tabletop normal", () => {
    expect(createDynamicGuideModel({
      positiveFace: "red",
      motionDirection: "clockwise",
      targetAngleDeg: 90,
    })).toEqual({
      top: "red",
      startFront: "white",
      startRight: "green",
      endFront: "green",
      direction: "clockwise",
      angleDeg: 90,
      cssTurnDeg: -90,
    });
  });

  it("reverses the endpoint and animation for counterclockwise", () => {
    const model = createDynamicGuideModel({
      positiveFace: "red",
      motionDirection: "counterclockwise",
      targetAngleDeg: 90,
    });
    expect(model.endFront).toBe("blue");
    expect(model.cssTurnDeg).toBe(90);
  });

  it("shows the opposite front after a half turn", () => {
    const model = createDynamicGuideModel({
      positiveFace: "white",
      motionDirection: "clockwise",
      targetAngleDeg: 180,
    });
    expect(model.startFront).toBe("green");
    expect(model.endFront).toBe("blue");
    expect(model.cssTurnDeg).toBe(-180);
  });
});
