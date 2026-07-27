import { describe, expect, it } from "vitest";
import {
  axisDot,
  matchesAxisDirection,
  relativeProtocolRotation,
} from "./relativeRotation";

describe("relative body rotation", () => {
  it("derives the local-axis 90 degree turn from a GAN16 validation capture", () => {
    const rotation = relativeProtocolRotation(
      { w: -0.28257480466022067, x: -0.6062280937218514, y: 0.32224941812369257, z: 0.6699211077974406 },
      { w: -0.4422212397238603, x: 0.03094633106142128, y: 0.02325552689231067, z: 0.8960702428938759 },
    );
    expect(rotation?.angleDeg).toBeCloseTo(88.8789, 3);
    expect(rotation?.axis.x).toBeCloseTo(0.00522, 3);
    expect(rotation?.axis.y).toBeCloseTo(-0.99962, 3);
    expect(rotation?.axis.z).toBeCloseTo(-0.02710, 3);
  });

  it("recognizes opposite directions on the same learned body axis", () => {
    const axis = { x: 0.8, y: -0.6, z: 0 };
    const positiveReference = axis;
    const opposite = { x: -0.8, y: 0.6, z: 0 };
    expect(axisDot(axis, opposite)).toBeCloseTo(-1);
    expect(matchesAxisDirection(axis, "positive", positiveReference)).toBe(true);
    expect(matchesAxisDirection(opposite, "negative", positiveReference)).toBe(true);
    expect(matchesAxisDirection(opposite, "positive", positiveReference)).toBe(false);
  });
});
