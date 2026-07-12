import { describe, expect, it } from "vitest";
import { createDynamicGuideModel } from "./calibrationGuide";
import type { CubeColor } from "./signalProfile";

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

  it("covers all 24 legal top/front pose nodes from 18 dynamic edges", () => {
    const tops: CubeColor[] = ["red", "orange", "blue", "green", "white", "yellow"];
    const motions = [
      { motionDirection: "clockwise" as const, targetAngleDeg: 90 as const },
      { motionDirection: "counterclockwise" as const, targetAngleDeg: 90 as const },
      { motionDirection: "clockwise" as const, targetAngleDeg: 180 as const },
    ];
    const poseKeys = new Set<string>();
    for (const top of tops) {
      const fronts = new Set<CubeColor>();
      for (const motion of motions) {
        const guide = createDynamicGuideModel({ positiveFace: top, ...motion });
        fronts.add(guide.startFront);
        fronts.add(guide.endFront);
        poseKeys.add(`${top}/${guide.startFront}`);
        poseKeys.add(`${top}/${guide.endFront}`);
      }
      expect(fronts.size).toBe(4);
    }
    expect(poseKeys.size).toBe(24);
  });
});
