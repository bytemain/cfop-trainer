import { describe, expect, it } from "vitest";
import { verifyCubieState } from "./cubie";

const SOLVED_CORNERS = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
const SOLVED_EDGES = Uint8Array.from([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);

describe("GAN cubie state verification", () => {
  it("accepts solved cubies and rejects impossible permutation parity", () => {
    expect(verifyCubieState({ corners: SOLVED_CORNERS, edges: SOLVED_EDGES })).toBe(true);

    const oddCorners = SOLVED_CORNERS.slice();
    [oddCorners[0], oddCorners[1]] = [oddCorners[1], oddCorners[0]];
    expect(verifyCubieState({ corners: oddCorners, edges: SOLVED_EDGES })).toBe(false);
  });

  it("rejects impossible corner and edge orientation sums", () => {
    const twistedCorner = SOLVED_CORNERS.slice();
    twistedCorner[0] = 8;
    expect(verifyCubieState({ corners: twistedCorner, edges: SOLVED_EDGES })).toBe(false);

    const flippedEdge = SOLVED_EDGES.slice();
    flippedEdge[0] = 1;
    expect(verifyCubieState({ corners: SOLVED_CORNERS, edges: flippedEdge })).toBe(false);
  });
});
