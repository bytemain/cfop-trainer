import { describe, expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import {
  FACES,
  SOLVED_COLORS,
  applyMove,
  parseMove,
  stickerGeometry,
  type CubeState,
  type Face,
  type StickerColor,
} from "./cube";
import {
  FACE_NORMALS,
  cubieInLayer,
  pivotAngleForMove,
  rotateHomeByMove,
  type MoveAmount,
} from "./layerAnimation";

type Vec = readonly [number, number, number];

interface SimSticker {
  normal: Vec;
  color: StickerColor;
}

interface SimCubie {
  home: Vec;
  stickers: SimSticker[];
}

const COORDS = [-1, 0, 1] as const;

function buildSolvedCubies(): SimCubie[] {
  const cubies: SimCubie[] = [];
  for (const x of COORDS) {
    for (const y of COORDS) {
      for (const z of COORDS) {
        const stickers: SimSticker[] = [];
        if (x !== 0) stickers.push({ normal: [x, 0, 0], color: SOLVED_COLORS[x === 1 ? "R" : "L"] });
        if (y !== 0) stickers.push({ normal: [0, y, 0], color: SOLVED_COLORS[y === 1 ? "U" : "D"] });
        if (z !== 0) stickers.push({ normal: [0, 0, z], color: SOLVED_COLORS[z === 1 ? "F" : "B"] });
        cubies.push({ home: [x, y, z], stickers });
      }
    }
  }
  return cubies;
}

const FACELET_LOOKUP = new Map<string, { face: Face; index: number }>();
for (const face of FACES) {
  for (let index = 0; index < 9; index += 1) {
    const { position, normal } = stickerGeometry(face, index);
    FACELET_LOOKUP.set([...position, ...normal].join(","), { face, index });
  }
}

function stateFromCubies(cubies: SimCubie[]): CubeState {
  const state = Object.fromEntries(
    FACES.map((face) => [face, Array<StickerColor>(9)]),
  ) as CubeState;
  for (const cubie of cubies) {
    for (const sticker of cubie.stickers) {
      const entry = FACELET_LOOKUP.get([...cubie.home, ...sticker.normal].join(","));
      expect(entry, `sticker at ${cubie.home} with normal ${sticker.normal}`).toBeTruthy();
      state[entry!.face][entry!.index] = sticker.color;
    }
  }
  return state;
}

function applyMoveToCubies(cubies: SimCubie[], face: Face, amount: MoveAmount): void {
  for (const cubie of cubies) {
    if (!cubieInLayer(cubie.home, face)) continue;
    cubie.home = rotateHomeByMove(cubie.home, face, amount);
    cubie.stickers = cubie.stickers.map((sticker) => ({
      ...sticker,
      normal: rotateHomeByMove(sticker.normal, face, amount),
    }));
  }
}

const ALL_MOVES = FACES.flatMap((face) => [face, `${face}'`, `${face}2`]);

describe("layer animation math", () => {
  test("every animated move lands on the applyMove facelet state", () => {
    for (const move of ALL_MOVES) {
      const parsed = parseMove(move);
      const cubies = buildSolvedCubies();
      const before = stateFromCubies(cubies);
      applyMoveToCubies(cubies, parsed.face, parsed.amount);
      expect(stateFromCubies(cubies), move).toEqual(applyMove(before, move));
    }
  });

  test("a scramble replayed through cubie rotations matches the facelet reducer", () => {
    const scramble = ["R", "U", "F'", "L2", "D'", "B", "R'", "U2", "F", "D", "B'", "L"];
    const cubies = buildSolvedCubies();
    let state = stateFromCubies(cubies);
    for (const move of scramble) {
      const parsed = parseMove(move);
      applyMoveToCubies(cubies, parsed.face, parsed.amount);
      state = applyMove(state, move);
      expect(stateFromCubies(cubies), `after ${move}`).toEqual(state);
    }
  });

  test("the 3D pivot angle rotates grid vectors identically to rotateHomeByMove", () => {
    const vectors: Vec[] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [1, 1, 0], [-1, 0, 1], [1, -1, -1], [1, 1, 1],
    ];
    for (const face of FACES) {
      for (const amount of [1, -1, 2] as const) {
        const normal = FACE_NORMALS[face];
        const rotation = new Quaternion().setFromAxisAngle(
          new Vector3(normal[0], normal[1], normal[2]),
          pivotAngleForMove(amount),
        );
        for (const vector of vectors) {
          const rotated = new Vector3(vector[0], vector[1], vector[2]).applyQuaternion(rotation);
          // `+ 0` normalizes IEEE -0 produced by rounding tiny float residue;
          // toEqual distinguishes -0 from +0 even though === does not.
          const snap = (value: number) => Math.round(value) + 0;
          const snapped: [number, number, number] = [snap(rotated.x), snap(rotated.y), snap(rotated.z)];
          expect(snapped, `${face}${amount} applied to ${vector}`).toEqual(
            rotateHomeByMove(vector, face, amount),
          );
        }
      }
    }
  });

  test("layer selection always contains exactly nine cubies", () => {
    for (const face of FACES) {
      const layer = buildSolvedCubies().filter((cubie) => cubieInLayer(cubie.home, face));
      expect(layer, face).toHaveLength(9);
    }
  });
});
