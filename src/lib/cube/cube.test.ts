import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyMoves,
  createSolvedCube,
  cubeStateFromFacelets,
  derivePhase,
  derivePhaseFacts,
  FACES,
  invertAlgorithm,
  invertMove,
  isSolved,
  normalizeMove,
  type CubeState,
  type Face,
  type StickerColor,
} from "./cube";

const COLOR_CODES: Record<string, StickerColor> = {
  W: "white",
  Y: "yellow",
  R: "red",
  O: "orange",
  B: "blue",
  G: "green",
};

function cubeFromCodes(codes: Record<Face, string>): CubeState {
  return Object.fromEntries(
    FACES.map((face) => [
      face,
      [...codes[face]].map((code) => COLOR_CODES[code]),
    ]),
  ) as CubeState;
}

describe("cube domain", () => {
  it("converts protocol facelets into the UI cube color model", () => {
    expect(
      cubeStateFromFacelets("UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"),
    ).toEqual(createSolvedCube());
  });

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

  it("detects a completed white cross on U from the live cube layout", () => {
    const state = cubeFromCodes({
      U: "YWWWWWRWY",
      R: "OROBRBBYW",
      F: "WGGBGOGRO",
      D: "RYWYYGYRG",
      L: "BOBGOYBOY",
      B: "GBORBORGR",
    });

    expect(derivePhaseFacts(state, "white").crossSolved).toBe(true);
    expect(derivePhaseFacts(state, "yellow").crossSolved).toBe(false);
  });

  it("advances to PLL when white F2L and yellow OLL are complete", () => {
    const state = cubeFromCodes({
      U: "WWWWWWWWW",
      R: "RRRRRRRRO",
      F: "GGGGGGOGG",
      D: "YYYYYYYYY",
      L: "OOOOOOBOB",
      B: "BBBBBBGBR",
    });
    const facts = derivePhaseFacts(state, "white");

    expect(facts.crossSolved).toBe(true);
    expect(facts.solvedF2lSlots).toBe(4);
    expect(facts.ollSolved).toBe(true);
    expect(facts.pllSolved).toBe(false);
    expect(derivePhase(state, "white")).toBe("pll");
  });
});
