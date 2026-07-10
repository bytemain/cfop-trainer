export const FACES = ["U", "R", "F", "D", "L", "B"] as const;

export type Face = (typeof FACES)[number];
export type StickerColor =
  | "white"
  | "yellow"
  | "red"
  | "orange"
  | "blue"
  | "green";

export type CubeState = Record<Face, StickerColor[]>;
export type StickerPalette = Record<StickerColor, string>;

export interface PhaseFacts {
  crossSolved: boolean;
  solvedF2lSlots: number;
  f2lSolved: boolean;
  ollSolved: boolean;
  pllSolved: boolean;
  cubeSolved: boolean;
}

export type CfopPhase = "cross" | "f2l" | "oll" | "pll" | "done";

type Vec3 = readonly [number, number, number];

interface Sticker {
  position: Vec3;
  normal: Vec3;
  color: StickerColor;
}

export const SOLVED_COLORS: Record<Face, StickerColor> = {
  U: "white",
  R: "red",
  F: "green",
  D: "yellow",
  L: "orange",
  B: "blue",
};

export const BRIGHT_STICKER_PALETTE: StickerPalette = {
  white: "#ffffff",
  yellow: "#ffe600",
  red: "#ff3045",
  orange: "#ff7a00",
  blue: "#1687ff",
  green: "#00d878",
};

export function createSolvedCube(): CubeState {
  return Object.fromEntries(
    FACES.map((face) => [face, Array<StickerColor>(9).fill(SOLVED_COLORS[face])]),
  ) as CubeState;
}

export function cubeStateFromFacelets(
  facelets: string,
  faceColors: Record<Face, StickerColor> = SOLVED_COLORS,
): CubeState {
  if (!/^[URFDLB]{54}$/.test(facelets)) {
    throw new Error("Cube snapshot must contain exactly 54 URFDLB facelets");
  }

  const counts = Object.fromEntries(FACES.map((face) => [face, 0])) as Record<Face, number>;
  for (const facelet of facelets) counts[facelet as Face] += 1;
  if (FACES.some((face) => counts[face] !== 9)) {
    throw new Error("Cube snapshot must contain nine facelets of each color");
  }

  return Object.fromEntries(
    FACES.map((face, faceIndex) => [
      face,
      [...facelets.slice(faceIndex * 9, faceIndex * 9 + 9)].map(
        (facelet) => faceColors[facelet as Face],
      ),
    ]),
  ) as CubeState;
}

export function remapCubeColors(
  state: CubeState,
  previous: Record<Face, StickerColor>,
  next: Record<Face, StickerColor>,
): CubeState {
  const substitutions = new Map<StickerColor, StickerColor>(
    FACES.map((face) => [previous[face], next[face]]),
  );
  return Object.fromEntries(
    FACES.map((face) => [
      face,
      state[face].map((color) => substitutions.get(color) ?? color),
    ]),
  ) as CubeState;
}

export function cloneCube(state: CubeState): CubeState {
  return Object.fromEntries(FACES.map((face) => [face, [...state[face]]])) as CubeState;
}

function stickerGeometry(face: Face, index: number): { position: Vec3; normal: Vec3 } {
  const row = Math.floor(index / 3);
  const column = index % 3;

  switch (face) {
    case "U":
      return { position: [column - 1, 1, row - 1], normal: [0, 1, 0] };
    case "D":
      return { position: [column - 1, -1, 1 - row], normal: [0, -1, 0] };
    case "F":
      return { position: [column - 1, 1 - row, 1], normal: [0, 0, 1] };
    case "B":
      return { position: [1 - column, 1 - row, -1], normal: [0, 0, -1] };
    case "R":
      return { position: [1, 1 - row, 1 - column], normal: [1, 0, 0] };
    case "L":
      return { position: [-1, 1 - row, column - 1], normal: [-1, 0, 0] };
  }
}

function faceIndexFromGeometry(normal: Vec3, position: Vec3): { face: Face; index: number } {
  const [x, y, z] = position;
  const [nx, ny, nz] = normal;

  if (ny === 1) return { face: "U", index: (z + 1) * 3 + (x + 1) };
  if (ny === -1) return { face: "D", index: (1 - z) * 3 + (x + 1) };
  if (nz === 1) return { face: "F", index: (1 - y) * 3 + (x + 1) };
  if (nz === -1) return { face: "B", index: (1 - y) * 3 + (1 - x) };
  if (nx === 1) return { face: "R", index: (1 - y) * 3 + (1 - z) };
  return { face: "L", index: (1 - y) * 3 + (z + 1) };
}

function toStickers(state: CubeState): Sticker[] {
  return FACES.flatMap((face) =>
    state[face].map((color, index) => ({ ...stickerGeometry(face, index), color })),
  );
}

function fromStickers(stickers: Sticker[]): CubeState {
  const result = Object.fromEntries(
    FACES.map((face) => [face, Array<StickerColor>(9)]),
  ) as CubeState;

  for (const sticker of stickers) {
    const { face, index } = faceIndexFromGeometry(sticker.normal, sticker.position);
    result[face][index] = sticker.color;
  }

  return result;
}

function normalizeQuarterTurns(turns: number): number {
  return ((turns % 4) + 4) % 4;
}

function rotatePositiveAxis(vector: Vec3, axis: 0 | 1 | 2, turns: number): Vec3 {
  let [x, y, z] = vector;

  for (let index = 0; index < normalizeQuarterTurns(turns); index += 1) {
    if (axis === 0) [y, z] = [-z, y];
    if (axis === 1) [x, z] = [z, -x];
    if (axis === 2) [x, y] = [-y, x];
  }

  return [x, y, z];
}

function rotateAroundNormal(vector: Vec3, normal: Vec3, turns: number): Vec3 {
  const axis = normal.findIndex((value) => value !== 0) as 0 | 1 | 2;
  const direction = normal[axis];
  return rotatePositiveAxis(vector, axis, turns * direction);
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export interface ParsedMove {
  face: Face;
  amount: 1 | -1 | 2;
}

export function parseMove(move: string): ParsedMove {
  const normalized = move.trim().replace("2'", "2");
  const match = /^([URFDLB])(2|')?$/.exec(normalized);

  if (!match) throw new Error(`Unsupported move notation: ${move}`);

  return {
    face: match[1] as Face,
    amount: match[2] === "'" ? -1 : match[2] === "2" ? 2 : 1,
  };
}

export function normalizeMove(move: string): string {
  const parsed = parseMove(move);
  return `${parsed.face}${parsed.amount === -1 ? "'" : parsed.amount === 2 ? "2" : ""}`;
}

export function invertMove(move: string): string {
  const parsed = parseMove(move);
  if (parsed.amount === 2) return `${parsed.face}2`;
  return `${parsed.face}${parsed.amount === 1 ? "'" : ""}`;
}

export function invertAlgorithm(moves: readonly string[]): string[] {
  return [...moves].reverse().map(invertMove);
}

export function applyMove(state: CubeState, notation: string): CubeState {
  const move = parseMove(notation);
  const faceGeometry = stickerGeometry(move.face, 4);
  const clockwiseTurnsAroundNormal = -move.amount;

  const stickers = toStickers(state).map((sticker) => {
    if (dot(sticker.position, faceGeometry.normal) !== 1) return sticker;

    return {
      ...sticker,
      position: rotateAroundNormal(
        sticker.position,
        faceGeometry.normal,
        clockwiseTurnsAroundNormal,
      ),
      normal: rotateAroundNormal(
        sticker.normal,
        faceGeometry.normal,
        clockwiseTurnsAroundNormal,
      ),
    };
  });

  return fromStickers(stickers);
}

export function applyMoves(state: CubeState, moves: readonly string[]): CubeState {
  return moves.reduce((current, move) => applyMove(current, move), cloneCube(state));
}

export function isSolved(state: CubeState): boolean {
  return FACES.every((face) => state[face].every((color) => color === state[face][4]));
}

function geometryKey(position: Vec3, normal: Vec3): string {
  return `${position.join(",")}|${normal.join(",")}`;
}

function stickerColorMap(state: CubeState): Map<string, StickerColor> {
  return new Map(
    toStickers(state).map((sticker) => [
      geometryKey(sticker.position, sticker.normal),
      sticker.color,
    ]),
  );
}

function cubiesAreSolved(state: CubeState, positions: readonly Vec3[]): boolean {
  const current = stickerColorMap(state);
  const solved = stickerColorMap(createSolvedCube());

  return positions.every((position) => {
    const stickers = toStickers(state).filter(
      (sticker) => sticker.position.every((value, index) => value === position[index]),
    );

    return stickers.every(
      (sticker) =>
        current.get(geometryKey(sticker.position, sticker.normal)) ===
        solved.get(geometryKey(sticker.position, sticker.normal)),
    );
  });
}

const CROSS_EDGE_POSITIONS: Vec3[] = [
  [0, -1, 1],
  [1, -1, 0],
  [0, -1, -1],
  [-1, -1, 0],
];

const F2L_SLOT_POSITIONS: Vec3[][] = [
  [
    [1, -1, 1],
    [1, 0, 1],
  ],
  [
    [-1, -1, 1],
    [-1, 0, 1],
  ],
  [
    [1, -1, -1],
    [1, 0, -1],
  ],
  [
    [-1, -1, -1],
    [-1, 0, -1],
  ],
];

export function derivePhaseFacts(state: CubeState): PhaseFacts {
  const crossSolved = cubiesAreSolved(state, CROSS_EDGE_POSITIONS);
  const solvedF2lSlots = F2L_SLOT_POSITIONS.filter((positions) =>
    cubiesAreSolved(state, positions),
  ).length;
  const f2lSolved = crossSolved && solvedF2lSlots === 4;
  const ollSolved = state.U.every((color) => color === state.U[4]);
  const pllSolved =
    ollSolved &&
    (["R", "F", "L", "B"] as Face[]).every((face) =>
      state[face].slice(0, 3).every((color) => color === state[face][0]),
    );
  const cubeSolved = isSolved(state);

  return { crossSolved, solvedF2lSlots, f2lSolved, ollSolved, pllSolved, cubeSolved };
}

export function derivePhase(state: CubeState): CfopPhase {
  const facts = derivePhaseFacts(state);
  if (facts.cubeSolved) return "done";
  if (facts.f2lSolved && facts.ollSolved) return "pll";
  if (facts.f2lSolved) return "oll";
  if (facts.crossSolved) return "f2l";
  return "cross";
}
