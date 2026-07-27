import type { Face } from "./cube";

export type MoveAmount = 1 | -1 | 2;

export const FACE_NORMALS: Record<Face, readonly [number, number, number]> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

/**
 * A parsed algorithm token, normalized to a rotation around an axis-aligned
 * outward normal:
 *  - face moves (U R F D L B): the outer layer on the normal's side;
 *  - wide moves (u r f d l b): that side plus the middle slice;
 *  - slice moves (M E S): the middle slice, following L / D / F direction;
 *  - rotations (x y z): the whole cube, following R / U / F direction.
 *
 * The pivot angle is always `-amount * 90°` around `normal`, matching how
 * `applyMove` / `rotateCube` rotate facelet vectors.
 */
export interface ParsedTurn {
  normal: readonly [number, number, number];
  layer: "outer" | "wide" | "middle" | "whole";
  amount: MoveAmount;
}

const FACE_TOKENS: Record<string, readonly [number, number, number]> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

// Slice moves follow their reference face: M follows L, E follows D, S
// follows F. Expressed as normals, "follow F" means the same pivot angle as
// F (-amount * 90° around +z), hence S uses the +z normal.
const SLICE_NORMALS: Record<string, readonly [number, number, number]> = {
  M: [-1, 0, 0],
  E: [0, -1, 0],
  S: [0, 0, 1],
};

const WIDE_NORMALS: Record<string, readonly [number, number, number]> = {
  u: [0, 1, 0],
  d: [0, -1, 0],
  r: [1, 0, 0],
  l: [-1, 0, 0],
  f: [0, 0, 1],
  b: [0, 0, -1],
};

const ROTATION_NORMALS: Record<string, readonly [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export function parseAlgorithmToken(token: string): ParsedTurn | null {
  const match = /^([URFDLBMESudlrfbxyz])(2'|2|')?$/.exec(token.trim());
  if (!match) return null;
  const symbol = match[1];
  const suffix = match[2] === "2'" ? "2" : match[2];
  const amount: MoveAmount = suffix === "'" ? -1 : suffix === "2" ? 2 : 1;
  if (FACE_TOKENS[symbol]) return { normal: FACE_TOKENS[symbol], layer: "outer", amount };
  if (WIDE_NORMALS[symbol]) return { normal: WIDE_NORMALS[symbol], layer: "wide", amount };
  if (SLICE_NORMALS[symbol]) return { normal: SLICE_NORMALS[symbol], layer: "middle", amount };
  return { normal: ROTATION_NORMALS[symbol], layer: "whole", amount };
}

/** Whether a cubie home position is swept by this turn. */
export function turnIncludesHome(
  home: readonly [number, number, number],
  turn: ParsedTurn,
): boolean {
  const axis = turn.normal.findIndex((value) => value !== 0);
  const sign = turn.normal[axis];
  const coordinate = home[axis];
  switch (turn.layer) {
    case "outer":
      return coordinate === sign;
    case "wide":
      return coordinate === sign || coordinate === 0;
    case "middle":
      return coordinate === 0;
    case "whole":
      return true;
  }
}

/**
 * Rotate a grid vector (cubie home or sticker normal) by this turn, exactly
 * matching how the facelet reducer rotates sticker vectors.
 */
export function rotateVectorByTurn(
  vector: readonly [number, number, number],
  turn: ParsedTurn,
): [number, number, number] {
  const normal = turn.normal;
  const axis = normal.findIndex((value) => value !== 0);
  const direction = normal[axis];
  let turns = (((-turn.amount * direction) % 4) + 4) % 4;
  let [x, y, z] = vector;
  while (turns > 0) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [x, z] = [z, -x];
    else [x, y] = [-y, x];
    turns -= 1;
  }
  // `+ 0` folds IEEE -0 (produced by negating zero) back to +0 so grid
  // vectors stay clean for comparisons and three.js positions.
  return [x + 0, y + 0, z + 0];
}

/** Signed pivot angle (radians) around the turn normal for 3D animation. */
export function pivotAngleForTurn(turn: ParsedTurn): number {
  return -turn.amount * (Math.PI / 2);
}

/**
 * Rotate a grid vector the way `applyMove` rotates facelet positions for a
 * plain face move: `amount` clockwise quarter turns around the given face's
 * outward normal, seen from outside the cube.
 */
export function rotateHomeByMove(
  home: readonly [number, number, number],
  face: Face,
  amount: MoveAmount,
): [number, number, number] {
  return rotateVectorByTurn(home, { normal: FACE_NORMALS[face], layer: "outer", amount });
}

/** Face-move pivot angle; matches `rotateHomeByMove`. */
export function pivotAngleForMove(amount: MoveAmount): number {
  return -amount * (Math.PI / 2);
}

/** Whether a cubie home position belongs to the outer layer of `face`. */
export function cubieInLayer(home: readonly [number, number, number], face: Face): boolean {
  const normal = FACE_NORMALS[face];
  return home[0] * normal[0] + home[1] * normal[1] + home[2] * normal[2] === 1;
}
