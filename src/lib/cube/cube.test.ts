import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyMoves,
  createSolvedCube,
  derivePhase,
  invertAlgorithm,
  invertMove,
  isSolved,
  normalizeMove,
} from "./cube";

describe("cube domain", () => {
  it("normalizes notation", () => {
    expect(normalizeMove("U2'")).toBe("U2");
    expect(invertMove("R")).toBe("R'");
    expect(invertMove("F2")).toBe("F2");
  });

  it("returns to solved after a move and its inverse", () => {
    const moved = applyMove(createSolvedCube(), "R");
    expect(isSolved(moved)).toBe(false);
    expect(isSolved(applyMove(moved, "R'"))).toBe(true);
  });

  it("returns to solved after four quarter turns", () => {
    const state = applyMoves(createSolvedCube(), ["U", "U", "U", "U"]);
    expect(isSolved(state)).toBe(true);
  });

  it("reverses an algorithm", () => {
    const scramble = ["R", "U", "R'", "F2", "D"];
    const scrambled = applyMoves(createSolvedCube(), scramble);
    const restored = applyMoves(scrambled, invertAlgorithm(scramble));
    expect(isSolved(restored)).toBe(true);
    expect(derivePhase(restored)).toBe("done");
  });
});

