import { describe, expect, it } from "vitest";
import { applyMove, applyMoves, createSolvedCube, invertAlgorithm, rotateCube } from "$lib/cube/cube";
import { MoveTimeline } from "$lib/timeline/moveTimeline";
import { recognizeCfopCase, reconstructSolve } from "./solveReconstruction";

function timelineFor(scramble: string[], solution: string[]) {
  const timeline = new MoveTimeline();
  let state = applyMoves(createSolvedCube(), scramble);
  solution.forEach((move, index) => {
    const before = state;
    state = applyMove(state, move);
    timeline.appendMove({
      sequence: index + 1,
      move,
      source: "live",
      cubeTime: index * 100 + (index === 2 ? 900 : 0),
      hostReceivedAt: index * 100,
      estimatedHostTime: index * 100,
      stateBefore: before,
      stateAfter: state,
    });
  });
  return timeline;
}

describe("solve reconstruction SSOT", () => {
  it("derives milestones, replay and timing only from MoveTimeline", () => {
    const scramble = ["R", "U", "F"];
    const solution = invertAlgorithm(scramble);
    const timeline = timelineFor(scramble, solution);
    const result = reconstructSolve(timeline.snapshot());
    expect(result.complete).toBe(true);
    expect(result.boundaries?.solved).toBe(3);
    expect(result.replayStates).toHaveLength(4);
    expect(result.totalDurationMs).toBe(1_100);
    expect(result.pauseCount).toBe(1);
  });

  it("refuses to call a snapshot-spliced solve complete", () => {
    const timeline = timelineFor(["R"], ["R'"]);
    timeline.markDiscontinuity("snapshot", 1, 4);
    expect(reconstructSolve(timeline.snapshot()).complete).toBe(false);
  });

  it("recognizes a known OLL under AUF", () => {
    const algorithm = "R U R' U R U2 R'".split(" ");
    let state = applyMoves(rotateCube(createSolvedCube(), "x2"), invertAlgorithm(algorithm));
    state = applyMove(state, "U");
    const recognized = recognizeCfopCase("oll", state);
    expect(recognized.id).toBe("oll-27");
    expect(recognized.confidence).toBe("exact");
  });
});
