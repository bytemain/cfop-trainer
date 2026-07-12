import { describe, expect, it } from "vitest";
import {
  createContinuousPoseGraphEdges,
  createDynamicGuideModel,
  POSE_GRAPH_NODE_SEQUENCE,
} from "./calibrationGuide";
import { expectedCubePoseMatrix } from "./signalProfile";
import { rotationDistanceDeg } from "$lib/cube/orientation";

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

  it("visits all 24 poses through a continuous air loop that returns to the anchor", () => {
    const edges = createContinuousPoseGraphEdges();
    expect(POSE_GRAPH_NODE_SEQUENCE).toHaveLength(24);
    expect(new Set(POSE_GRAPH_NODE_SEQUENCE.map((pose) => `${pose.top}/${pose.front}`)).size).toBe(24);
    expect(edges).toHaveLength(24);
    edges.forEach((edge, index) => {
      expect(edge.start).toEqual(POSE_GRAPH_NODE_SEQUENCE[index]);
      expect(edge.end).toEqual(POSE_GRAPH_NODE_SEQUENCE[(index + 1) % POSE_GRAPH_NODE_SEQUENCE.length]);
      const angle = rotationDistanceDeg(
        expectedCubePoseMatrix(edge.start.top, edge.start.front),
        expectedCubePoseMatrix(edge.end.top, edge.end.front),
      );
      expect(angle).toBeCloseTo(index === edges.length - 1 ? 180 : 90, 6);
      expect(edge.targetAngleDeg).toBe(index === edges.length - 1 ? 180 : 90);
    });
  });
});
