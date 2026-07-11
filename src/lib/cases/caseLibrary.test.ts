import { describe, expect, it } from "vitest";
import {
  CASE_LIBRARY,
  algorithmMoves,
  familiesFor,
  filterCases,
  selectCase,
} from "./caseLibrary";

describe("case library", () => {
  it("ships structurally complete patterns and at least one algorithm per case", () => {
    for (const item of CASE_LIBRARY) {
      expect(item.pattern.top, item.id).toHaveLength(9);
      expect(item.pattern.ring, item.id).toHaveLength(12);
      if (item.kind === "pll") expect(item.pattern.ringColors, item.id).toHaveLength(12);
      expect(item.algorithms.length, item.id).toBeGreaterThan(0);
      expect(item.algorithms.every((algorithm) => algorithmMoves(algorithm).length > 0), item.id).toBe(true);
    }
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
