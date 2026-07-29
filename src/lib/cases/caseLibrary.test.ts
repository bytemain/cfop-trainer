import { describe, expect, it } from "vitest";
import { executeMoves } from "$lib/cube/algorithm";
import { FACES, applyMoves, isSolved, type CubeState } from "$lib/cube/cube";
import {
  CASE_LIBRARY,
  algorithmMoves,
  familiesFor,
  filterCases,
  selectCase,
  type CfopCase,
} from "./caseLibrary";

const ollCases = CASE_LIBRARY.filter((item) => item.kind === "oll");
const pllCases = CASE_LIBRARY.filter((item) => item.kind === "pll");
const f2lCases = CASE_LIBRARY.filter((item) => item.kind === "f2l");

function lastLayerColor(item: CfopCase): string {
  return item.cube.U[4];
}

function orientedEdgeCount(item: CfopCase): number {
  const color = lastLayerColor(item);
  return [1, 3, 5, 7].filter((index) => item.cube.U[index] === color).length;
}

function f2lIntact(item: CfopCase, state: CubeState): boolean {
  const sides = FACES.filter((face) => face !== "U" && face !== "D");
  const sidesOk = sides.every((face) => {
    const center = state[face][4];
    return state[face].slice(3).every((color) => color === center);
  });
  const bottomOk = state.D.every((color) => color === state.D[4]);
  const crossColor = item.cube.D[4];
  return sidesOk && bottomOk && state.D[4] === crossColor;
}

function aufSignature(state: CubeState): string {
  const variants: string[] = [];
  let current = state;
  for (let auf = 0; auf < 4; auf += 1) {
    variants.push(FACES.flatMap((face) => current[face]).join(","));
    current = applyMoves(current, ["U"]);
  }
  return variants.sort().join("|");
}

describe("case library", () => {
  it("ships the complete 57 OLL, 21 PLL and 41 F2L case sets", () => {
    expect(ollCases.map((item) => item.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 57 }, (_, index) => index + 1));
    expect(pllCases).toHaveLength(21);
    expect(new Set(pllCases.map((item) => item.name)).size).toBe(21);
    expect(f2lCases.map((item) => item.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 41 }, (_, index) => index + 1));
    expect(new Set(f2lCases.map((item) => item.family)).size).toBe(8);
    expect(new Set(CASE_LIBRARY.map((item) => item.id)).size).toBe(119);
  });

  it("ships structurally complete patterns and at least one algorithm per case", () => {
    for (const item of CASE_LIBRARY) {
      if (item.kind !== "f2l") {
        expect(item.pattern?.top, item.id).toHaveLength(9);
        expect(item.pattern?.ring, item.id).toHaveLength(12);
        if (item.kind === "pll") expect(item.pattern?.ringColors, item.id).toHaveLength(12);
      }
      expect(item.algorithms.length, item.id).toBeGreaterThan(0);
      expect(item.algorithms.every((algorithm) => algorithmMoves(algorithm).length > 0), item.id).toBe(true);
    }
  });

  it("derives OLL diagrams whose every listed algorithm orients the last layer and keeps F2L", () => {
    for (const item of ollCases) {
      const color = lastLayerColor(item);
      for (const algorithm of item.algorithms) {
        const solved = executeMoves(item.cube, algorithmMoves(algorithm));
        expect(solved.U.every((sticker) => sticker === color), `${item.id} ${algorithm.id}`).toBe(true);
        expect(f2lIntact(item, solved), `${item.id} ${algorithm.id} F2L`).toBe(true);
      }
    }
  });

  it("derives PLL diagrams whose every listed algorithm solves the cube", () => {
    for (const item of pllCases) {
      for (const algorithm of item.algorithms) {
        const solved = executeMoves(item.cube, algorithmMoves(algorithm));
        expect(isSolved(solved), `${item.id} ${algorithm.id}`).toBe(true);
      }
    }
  });

  it("keeps OLL cases distinct up to AUF", () => {
    const signatures = ollCases.map((item) => aufSignature(item.cube));
    expect(new Set(signatures).size).toBe(ollCases.length);
  });

  it("keeps PLL cases distinct up to AUF", () => {
    const signatures = pllCases.map((item) => aufSignature(item.cube));
    expect(new Set(signatures).size).toBe(pllCases.length);
  });

  it("derives F2L cases whose every listed algorithm solves the cube", () => {
    for (const item of f2lCases) {
      for (const algorithm of item.algorithms) {
        const solved = executeMoves(item.cube, algorithmMoves(algorithm));
        expect(isSolved(solved), `${item.id} ${algorithm.id}`).toBe(true);
      }
    }
  });

  it("keeps F2L cases distinct up to U rotation", () => {
    const signatures = f2lCases.map((item) => aufSignature(item.cube));
    const unique = new Set(signatures);
    if (unique.size !== f2lCases.length) {
      const collisions = f2lCases.filter(
        (item, index) => signatures.indexOf(signatures[index]) !== index,
      );
      throw new Error(`duplicate F2L cases: ${collisions.map((item) => item.id).join(", ")}`);
    }
  });

  it("matches the OLL edge-orientation class of every case number", () => {
    // Dot cases (1-4, 17-20) orient no edge; cross cases (21-27) orient all
    // four; every other OLL orients exactly two.
    const dots = new Set([1, 2, 3, 4, 17, 18, 19, 20]);
    for (const item of ollCases) {
      const expected = dots.has(item.number) ? 0 : item.number >= 21 && item.number <= 27 ? 4 : 2;
      expect(orientedEdgeCount(item), `${item.id} ${item.name}`).toBe(expected);
    }
  });

  it("keeps the 2-look drill set available under the 十字 family", () => {
    const cross = filterCases({ kind: "oll", query: "", family: "十字" });
    expect(cross.map((item) => item.number).sort((a, b) => a - b)).toEqual([21, 22, 23, 24, 25, 26, 27]);
  });

  it("filters by OLL/PLL category and family", () => {
    const oll = filterCases({ kind: "oll", query: "", family: "十字" });
    expect(oll.length).toBeGreaterThan(0);
    expect(oll.every((item) => item.kind === "oll" && item.family === "十字")).toBe(true);
    expect(familiesFor("pll")).toContain("棱置换");
  });

  it("searches names, aliases, recognition hints, tags and algorithms", () => {
    expect(filterCases({ kind: "oll", query: "逆小鱼", family: "all" }).map((item) => item.id))
      .toEqual(["oll-26"]);
    expect(filterCases({ kind: "pll", query: "车灯", family: "all" }).map((item) => item.id))
      .toContain("pll-t");
    expect(filterCases({ kind: "pll", query: "M2 U'", family: "all" }).map((item) => item.id))
      .toContain("pll-ub");
  });

  it("keeps the current selection when visible and falls back to the first result", () => {
    const pll = filterCases({ kind: "pll", query: "", family: "all" });
    expect(selectCase("pll-t", pll)?.id).toBe("pll-t");
    expect(selectCase("oll-27", pll)?.id).toBe(pll[0].id);
    expect(selectCase(null, [])).toBeNull();
  });

  it("turns readable algorithm segments into structured move tokens", () => {
    const sune = CASE_LIBRARY.find((item) => item.id === "oll-27");
    expect(algorithmMoves(sune!.algorithms[0])).toEqual(["R", "U", "R'", "U", "R", "U2", "R'"]);
  });
});
