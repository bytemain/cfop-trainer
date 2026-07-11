import { describe, expect, it } from "vitest";
import { applyMove, createSolvedCube } from "$lib/cube/cube";
import { MoveTimeline } from "./moveTimeline";

describe("MoveTimeline", () => {
  it("does not present moves before a snapshot discontinuity as one reconstruction", () => {
    const timeline = new MoveTimeline();
    const before = createSolvedCube();
    timeline.appendMove({
      sequence: 10,
      move: "R",
      source: "live",
      cubeTime: 1_000,
      hostReceivedAt: 2_000,
      estimatedHostTime: 2_000,
      stateBefore: before,
      stateAfter: applyMove(before, "R"),
    });
    timeline.markDiscontinuity("history-timeout", 10, 14, 2_500);
    const after = createSolvedCube();
    timeline.appendMove({
      sequence: 15,
      move: "U",
      source: "live",
      cubeTime: 1_500,
      hostReceivedAt: 3_000,
      estimatedHostTime: 3_000,
      stateBefore: after,
      stateAfter: applyMove(after, "U"),
    });
    expect(timeline.movesSinceLastDiscontinuity().map((item) => item.sequence)).toEqual([15]);
  });
});
