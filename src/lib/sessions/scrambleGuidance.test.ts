import { describe, expect, it } from "vitest";
import { decideScrambleMove, type ScrambleFault } from "./scrambleGuidance";

const scramble = ["R", "U", "F'", "L2"];

describe("scramble move decisions", () => {
  it("advances on the expected move", () => {
    expect(
      decideScrambleMove({
        scramble,
        index: 1,
        move: "U",
        fault: null,
        stateMatchesPrefix: false,
        stateMatchesPreviousPrefix: false,
      }),
    ).toEqual({ kind: "advance", clearFault: false });
  });

  it("steps back when the user undoes the previous step", () => {
    expect(
      decideScrambleMove({
        scramble,
        index: 1,
        move: "R'",
        fault: null,
        stateMatchesPrefix: false,
        stateMatchesPreviousPrefix: true,
      }),
    ).toEqual({ kind: "undo" });
  });

  it("does not treat the inverse as undo when the state does not match", () => {
    expect(
      decideScrambleMove({
        scramble,
        index: 1,
        move: "R'",
        fault: null,
        stateMatchesPrefix: false,
        stateMatchesPreviousPrefix: false,
      }),
    ).toEqual({ kind: "fault", fault: { index: 1, expected: "U", got: "R'" } });
  });

  it("never treats the first step as undo", () => {
    expect(
      decideScrambleMove({
        scramble,
        index: 0,
        move: "R'",
        fault: null,
        stateMatchesPrefix: false,
        stateMatchesPreviousPrefix: true,
      }).kind,
    ).toBe("fault");
  });

  it("records a fault on a wrong move and keeps the original index", () => {
    const fault: ScrambleFault = { index: 1, expected: "U", got: "F" };
    expect(
      decideScrambleMove({
        scramble,
        index: 1,
        move: "B",
        fault,
        stateMatchesPrefix: false,
        stateMatchesPreviousPrefix: false,
      }),
    ).toEqual({ kind: "fault", fault: { index: 1, expected: "U", got: "B" } });
  });

  it("recovers when the state returns to the prefix without the expected move", () => {
    const fault: ScrambleFault = { index: 1, expected: "U", got: "F" };
    expect(
      decideScrambleMove({
        scramble,
        index: 1,
        move: "F'",
        fault,
        stateMatchesPrefix: true,
        stateMatchesPreviousPrefix: false,
      }),
    ).toEqual({ kind: "recover" });
  });

  it("advances and clears the fault when the expected move also restores the prefix", () => {
    const fault: ScrambleFault = { index: 1, expected: "U", got: "F" };
    expect(
      decideScrambleMove({
        scramble,
        index: 1,
        move: "U",
        fault,
        stateMatchesPrefix: true,
        stateMatchesPreviousPrefix: false,
      }),
    ).toEqual({ kind: "advance", clearFault: true });
  });

  it("keeps the fault while advancing with a still-diverged state", () => {
    const fault: ScrambleFault = { index: 1, expected: "U", got: "F" };
    expect(
      decideScrambleMove({
        scramble,
        index: 1,
        move: "U",
        fault,
        stateMatchesPrefix: false,
        stateMatchesPreviousPrefix: false,
      }),
    ).toEqual({ kind: "advance", clearFault: false });
  });
});
