import { describe, expect, it } from "vitest";
import { applyMove, applyMoves, createSolvedCube, isSolved } from "./cube";
import { executeMoves, invertToken, invertTokens, tokenizeAlgorithm } from "./algorithm";

const solved = createSolvedCube();

describe("algorithm execution", () => {
  it("tokenizes algorithms and strips grouping parentheses", () => {
    expect(tokenizeAlgorithm("R U R' U' (R' F R F')")).toEqual(["R", "U", "R'", "U'", "R'", "F", "R", "F'"]);
    expect(tokenizeAlgorithm("R2 U (R U R' U') R' U' R' U R'")).toEqual([
      "R2", "U", "R", "U", "R'", "U'", "R'", "U'", "R'", "U", "R'",
    ]);
  });

  it("inverts tokens including slices and rotations", () => {
    expect(invertToken("R")).toBe("R'");
    expect(invertToken("R'")).toBe("R");
    expect(invertToken("R2")).toBe("R2");
    expect(invertToken("M2")).toBe("M2");
    expect(invertToken("x")).toBe("x'");
    expect(invertTokens(["R", "U", "M2", "x'"])).toEqual(["x", "M2", "U'", "R'"]);
  });

  it("executes plain face moves exactly like applyMoves", () => {
    const moves = ["R", "U", "F'", "L2", "D'", "B"];
    expect(executeMoves(solved, moves)).toEqual(applyMoves(solved, moves));
  });

  it("executes whole-cube rotations like rotateCube semantics", () => {
    // Conjugation ground truths: y R y' = B and x U x' = F.
    expect(executeMoves(solved, ["y", "R", "y'"])).toEqual(applyMove(solved, "B"));
    expect(executeMoves(solved, ["x", "U", "x'"])).toEqual(applyMove(solved, "F"));
  });

  it("executes M slices as the standard H perm", () => {
    const state = executeMoves(solved, tokenizeAlgorithm("M2 U M2 U2 M2 U M2"));
    // H perm swaps opposite edges; corners and centers stay put.
    expect(state.U.every((color) => color === "white")).toBe(true);
    expect(state.D.every((color) => color === "yellow")).toBe(true);
    expect(state.F[1]).toBe("blue");
    expect(state.B[1]).toBe("green");
    expect(state.L[1]).toBe("red");
    expect(state.R[1]).toBe("orange");
    expect(state.F[0]).toBe("green");
    expect(state.R[8]).toBe("red");
  });

  it("treats wide moves as face plus middle slice", () => {
    // r2 = R2 + M2: check against manual composition.
    expect(executeMoves(solved, ["r2"])).toEqual(executeMoves(solved, ["R2", "M2"]));
    expect(executeMoves(solved, ["l'"])).toEqual(executeMoves(solved, ["L'", "M'"]));
    expect(executeMoves(solved, ["u"])).toEqual(executeMoves(solved, ["U", "E'"]));
    expect(executeMoves(solved, ["d"])).toEqual(executeMoves(solved, ["D", "E"]));
    expect(executeMoves(solved, ["d'"])).toEqual(executeMoves(solved, ["D'", "E'"]));
    expect(executeMoves(solved, ["d2"])).toEqual(executeMoves(solved, ["D2", "E2"]));
    expect(executeMoves(solved, ["f'"])).toEqual(executeMoves(solved, ["F'", "S'"]));
    expect(executeMoves(solved, ["b"])).toEqual(executeMoves(solved, ["B", "S'"]));
  });

  it("round-trips any supported algorithm through its inverse", () => {
    const algorithms = [
      "R U R' U R U2 R'",
      "r U R' U' r' F R F'",
      "M2 U M2 U2 M2 U M2",
      "x R' U R' D2 R U' R' D2 R2 x'",
      "R' U R' U' y R' F' R2 U' R' U R' F R F",
      "r' R2 U R' U r U2 r' U M'",
      "y' U' R' U R",
      "U' R U2' R' U y' R' U' R",
      "U' R U' R' U y' R' U R",
    ];
    for (const algorithm of algorithms) {
      const tokens = tokenizeAlgorithm(algorithm);
      const there = executeMoves(solved, tokens);
      const back = executeMoves(there, invertTokens(tokens));
      expect(back, algorithm).toEqual(solved);
      expect(isSolved(back)).toBe(true);
    }
  });

  it("rejects unknown tokens", () => {
    expect(() => executeMoves(solved, ["Q"])).toThrow();
  });
});
