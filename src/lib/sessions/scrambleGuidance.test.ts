import { describe, expect, it } from "vitest";
import { applyMoves, createSolvedCube, cubeEquals } from "$lib/cube/cube";
import { decideScrambleMove, type ScrambleFault } from "./scrambleGuidance";

const scramble = ["R", "U", "F'", "L2"];

/**
 * Compute the three prefix-match booleans the way the store does: apply `move`
 * on top of the prefix at `index`, then compare against the neighbouring
 * prefix states. This keeps the unit tests honest about real cube geometry.
 */
function prefixMatches(seq: readonly string[], index: number, move: string) {
  const base = createSolvedCube();
  const after = applyMoves(applyMoves(base, seq.slice(0, index)), [move]);
  const prefixAt = (i: number) => applyMoves(base, seq.slice(0, Math.max(0, i)));
  return {
    matchesNextPrefix: cubeEquals(after, prefixAt(index + 1)),
    matchesCurrentPrefix: cubeEquals(after, prefixAt(index)),
    matchesPreviousPrefix: index > 0 && cubeEquals(after, prefixAt(index - 1)),
  };
}

function decide(seq: readonly string[], index: number, move: string, fault: ScrambleFault | null = null) {
  return decideScrambleMove({ scramble: seq, index, move, fault, ...prefixMatches(seq, index, move) });
}

describe("scramble move decisions", () => {
  it("advances on the expected single move", () => {
    expect(decide(scramble, 1, "U")).toEqual({ kind: "advance", clearFault: false });
  });

  it("steps back when the user undoes the previous step", () => {
    expect(decide(scramble, 1, "R'")).toEqual({ kind: "undo" });
  });

  it("faults on a wrong move", () => {
    expect(decide(scramble, 1, "F")).toEqual({
      kind: "fault",
      fault: { index: 1, expected: "U", got: "F" },
    });
  });

  it("never treats the first step as undo", () => {
    expect(decide(scramble, 0, "R'").kind).toBe("fault");
  });

  it("holds the first quarter turn of an expected double turn", () => {
    // scramble[3] === "L2"; the cube reports it as two quarter turns. The first
    // "L" leaves the cube halfway to the L2 prefix and must not fault.
    expect(decide(scramble, 3, "L")).toEqual({ kind: "hold" });
  });

  it("holds the first quarter turn of a double turn done in the opposite direction", () => {
    expect(decide(scramble, 3, "L'")).toEqual({ kind: "hold" });
  });

  it("advances once the double turn completes (same direction)", () => {
    // After the first "L" the store keeps index 3; the second "L" is applied on
    // top of the half-turned cube, landing on the L2 prefix.
    const base = createSolvedCube();
    const halfTurned = applyMoves(applyMoves(base, scramble.slice(0, 3)), ["L"]);
    const after = applyMoves(halfTurned, ["L"]);
    const prefixAt = (i: number) => applyMoves(base, scramble.slice(0, i));
    const decision = decideScrambleMove({
      scramble,
      index: 3,
      move: "L",
      fault: null,
      matchesNextPrefix: cubeEquals(after, prefixAt(4)),
      matchesCurrentPrefix: cubeEquals(after, prefixAt(3)),
      matchesPreviousPrefix: cubeEquals(after, prefixAt(2)),
    });
    expect(decision).toEqual({ kind: "advance", clearFault: false });
  });

  it("advances once the double turn completes (opposite direction)", () => {
    const base = createSolvedCube();
    const halfTurned = applyMoves(applyMoves(base, scramble.slice(0, 3)), ["L'"]);
    const after = applyMoves(halfTurned, ["L'"]);
    const prefixAt = (i: number) => applyMoves(base, scramble.slice(0, i));
    const decision = decideScrambleMove({
      scramble,
      index: 3,
      move: "L'",
      fault: null,
      matchesNextPrefix: cubeEquals(after, prefixAt(4)),
      matchesCurrentPrefix: cubeEquals(after, prefixAt(3)),
      matchesPreviousPrefix: cubeEquals(after, prefixAt(2)),
    });
    expect(decision).toEqual({ kind: "advance", clearFault: false });
  });

  it("holds the first quarter turn while undoing a double turn", () => {
    // Undoing scramble[3] === "L2": the first quarter turn of the unwind leaves
    // the cube one quarter from the previous prefix and must not fault.
    const base = createSolvedCube();
    const current = applyMoves(base, scramble.slice(0, 4)); // ...+ L2
    const after = applyMoves(current, ["L"]);
    const prefixAt = (i: number) => applyMoves(base, scramble.slice(0, i));
    const decision = decideScrambleMove({
      scramble,
      index: 4,
      move: "L",
      fault: null,
      matchesNextPrefix: cubeEquals(after, prefixAt(5)),
      matchesCurrentPrefix: cubeEquals(after, prefixAt(4)),
      matchesPreviousPrefix: cubeEquals(after, prefixAt(3)),
    });
    expect(decision).toEqual({ kind: "hold" });
  });

  it("undoes once the double turn unwind completes", () => {
    const base = createSolvedCube();
    const current = applyMoves(base, scramble.slice(0, 4));
    const after = applyMoves(current, ["L", "L"]); // L2 unwinds L2
    const prefixAt = (i: number) => applyMoves(base, scramble.slice(0, i));
    const decision = decideScrambleMove({
      scramble,
      index: 4,
      move: "L",
      fault: null,
      matchesNextPrefix: cubeEquals(after, prefixAt(5)),
      matchesCurrentPrefix: cubeEquals(after, prefixAt(4)),
      matchesPreviousPrefix: cubeEquals(after, prefixAt(3)),
    });
    expect(decision).toEqual({ kind: "undo" });
  });

  it("keeps the original fault index while diverging", () => {
    const fault: ScrambleFault = { index: 1, expected: "U", got: "F" };
    expect(decide(scramble, 1, "B", fault)).toEqual({
      kind: "fault",
      fault: { index: 1, expected: "U", got: "B" },
    });
  });

  it("recovers when a faulted cube returns to the current prefix", () => {
    const fault: ScrambleFault = { index: 1, expected: "U", got: "F" };
    // The user undid the stray "F" with "F'", returning to base + R.
    const base = createSolvedCube();
    const diverged = applyMoves(applyMoves(base, scramble.slice(0, 1)), ["F"]);
    const after = applyMoves(diverged, ["F'"]);
    const prefixAt = (i: number) => applyMoves(base, scramble.slice(0, i));
    const decision = decideScrambleMove({
      scramble,
      index: 1,
      move: "F'",
      fault,
      matchesNextPrefix: cubeEquals(after, prefixAt(2)),
      matchesCurrentPrefix: cubeEquals(after, prefixAt(1)),
      matchesPreviousPrefix: cubeEquals(after, prefixAt(0)),
    });
    expect(decision).toEqual({ kind: "recover" });
  });

  it("advances and clears the fault when the cube reaches the next prefix", () => {
    const fault: ScrambleFault = { index: 1, expected: "U", got: "F" };
    expect(decide(scramble, 1, "U", fault)).toEqual({ kind: "advance", clearFault: true });
  });
});
