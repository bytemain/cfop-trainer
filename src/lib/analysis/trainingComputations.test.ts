import { describe, expect, it } from "vitest";
import { applyMoves, createSolvedCube, deriveF2lSlotFacts } from "$lib/cube/cube";
import { compareAlgorithms, normalizeCubeRotations } from "./algorithmNormalization";
import { solveCrossOptimal } from "./crossSolver";

describe("CubeStation-grade training computations", () => {
  it("finds an HTM-optimal cross solution for a short scramble", () => {
    const state = applyMoves(createSolvedCube(), ["F", "R"]);
    const solution = solveCrossOptimal(state, "white", 4);
    expect(solution).not.toBeNull();
    expect(solution!.length).toBeLessThanOrEqual(2);
  });

  it("solves a competition-length scramble within the eight-move cross bound", () => {
    const scramble = "R U2 F' L2 D B2 R' U F2 D' L U2 B R2 D2 F U' L2 B' D".split(" ");
    const state = applyMoves(createSolvedCube(), scramble);
    const solution = solveCrossOptimal(state, "white", 8);
    expect(solution).not.toBeNull();
    expect(solution!.length).toBeLessThanOrEqual(8);
  });

  it("reports four physical F2L pairs", () => {
    const slots = deriveF2lSlotFacts(createSolvedCube(), "white");
    expect(slots).toHaveLength(4);
    expect(slots.every((slot) => slot.solved)).toBe(true);
  });

  it("normalizes whole-cube rotations and ignores AUF during formula comparison", () => {
    expect(normalizeCubeRotations(["y", "R", "y'"])).toEqual(["F"]);
    expect(compareAlgorithms(["U", "R", "U", "R'", "U'"], ["R", "U", "R'"]).equivalentIgnoringAufAndRotations).toBe(true);
  });
});
