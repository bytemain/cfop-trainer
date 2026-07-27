import {
  applyMove,
  fromStickers,
  rotateCube,
  toStickers,
  type CubeState,
  type Vec3,
} from "./cube";
import { parseAlgorithmToken, type ParsedTurn } from "./layerAnimation";

/** Strip grouping parentheses and split an algorithm string into tokens. */
export function tokenizeAlgorithm(algorithm: string): string[] {
  return algorithm
    .replace(/[()]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function invertToken(token: string): string {
  const normalized = token.replace("2'", "2");
  if (normalized.endsWith("2")) return normalized;
  if (normalized.endsWith("'")) return normalized.slice(0, -1);
  return `${normalized}'`;
}

export function invertTokens(tokens: readonly string[]): string[] {
  return [...tokens].reverse().map(invertToken);
}

function rotateGridVector(vector: Vec3, axis: number, quarterTurns: number): Vec3 {
  let turns = ((quarterTurns % 4) + 4) % 4;
  let [x, y, z] = vector;
  while (turns > 0) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [x, z] = [z, -x];
    else [x, y] = [-y, x];
    turns -= 1;
  }
  return [x + 0, y + 0, z + 0];
}

/**
 * Turn the middle slice around `axis`. `quarterTurns` uses the same
 * positive rotation sense as the facelet reducer's rotatePositiveAxis.
 */
function applySlice(state: CubeState, axis: number, quarterTurns: number): CubeState {
  return fromStickers(
    toStickers(state).map((sticker) => {
      if (sticker.position[axis] !== 0) return sticker;
      return {
        ...sticker,
        position: rotateGridVector(sticker.position, axis, quarterTurns),
        normal: rotateGridVector(sticker.normal, axis, quarterTurns),
      };
    }),
  );
}

/** Quarter turns for a slice move token (M follows L, E follows D, S follows F). */
function sliceQuarterTurns(turn: ParsedTurn): { axis: number; quarterTurns: number } {
  const axis = turn.normal.findIndex((value) => value !== 0);
  const direction = turn.normal[axis];
  return { axis, quarterTurns: -turn.amount * direction };
}

// A wide turn is the outer face plus the matching middle slice:
// r=R+M', l=L+M, u=U+E', d=D+E, f=F+S, b=B+S'.
const WIDE_SLICE: Record<string, { axis: number; direction: 1 | -1 }> = {
  r: { axis: 0, direction: -1 },
  l: { axis: 0, direction: 1 },
  u: { axis: 1, direction: -1 },
  d: { axis: 1, direction: 1 },
  f: { axis: 2, direction: -1 },
  b: { axis: 2, direction: 1 },
};

function applySingleToken(state: CubeState, rawToken: string): CubeState {
  const token = rawToken.trim().replace("2'", "2");
  const turn = parseAlgorithmToken(token);
  if (!turn) throw new Error(`Unsupported algorithm token: ${rawToken}`);
  const symbol = token.charAt(0);
  if ("URFDLB".includes(symbol)) return applyMove(state, token);
  if ("xyz".includes(symbol)) return rotateCube(state, token);
  if (turn.layer === "middle") {
    const { axis, quarterTurns } = sliceQuarterTurns(turn);
    return applySlice(state, axis, quarterTurns);
  }
  const slice = WIDE_SLICE[symbol];
  const withFace = applyMove(state, symbol.toUpperCase() + token.slice(1));
  return applySlice(withFace, slice.axis, slice.direction * turn.amount);
}

/**
 * Execute a full algorithm against a cube state. Supports face moves,
 * wide moves (r l f b u d), slice moves (M E S) and whole-cube rotations
 * (x y z), each with optional ' or 2 suffix.
 */
export function executeMoves(state: CubeState, tokens: readonly string[]): CubeState {
  return tokens.reduce((current, token) => applySingleToken(current, token), state);
}
