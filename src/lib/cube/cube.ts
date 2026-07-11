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

export interface F2lSlotFact {
  id: string;
  colors: StickerColor[];
  solved: boolean;
}

export interface CrossEdgeCoordinate {
  id: string;
  coordinate: string;
  solved: boolean;
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

export function rotateCube(state: CubeState, notation: string): CubeState {
  const match = /^([xyz])(2|')?$/.exec(notation.trim());
  if (!match) throw new Error(`Unsupported cube rotation: ${notation}`);
  const axis = ({ x: 0, y: 1, z: 2 } as const)[match[1] as "x" | "y" | "z"];
  const amount = match[2] === "'" ? -1 : match[2] === "2" ? 2 : 1;
  const turns = -amount;
  return fromStickers(toStickers(state).map((sticker) => ({
    ...sticker,
    position: rotatePositiveAxis(sticker.position, axis, turns),
    normal: rotatePositiveAxis(sticker.normal, axis, turns),
  })));
}

export function isSolved(state: CubeState): boolean {
  return FACES.every((face) => state[face].every((color) => color === state[face][4]));
}

function cubiesAreSolved(state: CubeState, positions: readonly Vec3[]): boolean {
  const stickers = toStickers(state);

  return positions.every((position) => {
    const cubieStickers = stickers.filter(
      (sticker) => sticker.position.every((value, index) => value === position[index]),
    );

    return cubieStickers.every(
      (sticker) => {
        const { face } = faceIndexFromGeometry(sticker.normal, [0, 0, 0]);
        return sticker.color === state[face][4];
      },
    );
  });
}

function positions(): Vec3[] {
  const values = [-1, 0, 1] as const;
  return values.flatMap((x) =>
    values.flatMap((y) => values.map((z) => [x, y, z] as Vec3)),
  );
}

function sameVector(left: Vec3, right: Vec3): boolean {
  return left.every((value, index) => value === right[index]);
}

function faceForNormal(normal: Vec3): Face {
  return faceIndexFromGeometry(normal, [0, 0, 0]).face;
}

function crossFaceForColor(state: CubeState, crossColor: StickerColor): Face {
  return FACES.find((face) => state[face][4] === crossColor) ?? "D";
}

function crossEdgePositions(crossNormal: Vec3): Vec3[] {
  return positions().filter(
    (position) =>
      dot(position, crossNormal) === 1 &&
      position.filter((value) => value === 0).length === 1,
  );
}

function f2lSlotPositions(crossNormal: Vec3): Vec3[][] {
  const crossAxis = crossNormal.findIndex((value) => value !== 0);
  return positions()
    .filter(
      (position) =>
        dot(position, crossNormal) === 1 &&
        position.every((value) => Math.abs(value) === 1),
    )
    .map((corner) => {
      const edge = [...corner] as [number, number, number];
      edge[crossAxis] = 0;
      return [corner, edge];
    });
}

export function deriveF2lSlotFacts(
  state: CubeState,
  crossColor: StickerColor = "white",
): F2lSlotFact[] {
  const crossFace = crossFaceForColor(state, crossColor);
  const crossNormal = stickerGeometry(crossFace, 4).normal;
  const stickers = toStickers(state);
  return f2lSlotPositions(crossNormal).map((positionsForSlot) => {
    const corner = positionsForSlot[0];
    const colors = stickers
      .filter((sticker) => sticker.position.every((value, index) => value === corner[index]))
      .map((sticker) => sticker.color);
    const sideColors = colors.filter((color) => color !== crossColor).sort();
    return {
      id: sideColors.join("-"),
      colors,
      solved: cubiesAreSolved(state, positionsForSlot),
    };
  });
}

export function deriveCrossEdgeCoordinates(
  state: CubeState,
  crossColor: StickerColor = "white",
): CrossEdgeCoordinate[] {
  const crossFace = crossFaceForColor(state, crossColor);
  const crossNormal = stickerGeometry(crossFace, 4).normal;
  const stickers = toStickers(state);
  return positions().filter((position) => position.filter((value) => value === 0).length === 1)
    .flatMap((position) => {
      const cubie = stickers.filter((sticker) => sticker.position.every((value, index) => value === position[index]));
      const crossSticker = cubie.find((sticker) => sticker.color === crossColor);
      if (!crossSticker) return [];
      const partner = cubie.find((sticker) => sticker.color !== crossColor)!;
      const partnerGoalFace = FACES.find((face) => state[face][4] === partner.color)!;
      const partnerGoalNormal = stickerGeometry(partnerGoalFace, 4).normal;
      return [{
        id: partner.color,
        coordinate: `${position.join("")}:${crossSticker.normal.join("")}`,
        solved: sameVector(crossSticker.normal, crossNormal) && sameVector(partner.normal, partnerGoalNormal),
      }];
    }).sort((left, right) => left.id.localeCompare(right.id));
}

export function derivePhaseFacts(
  state: CubeState,
  crossColor: StickerColor = "white",
): PhaseFacts {
  const crossFace = crossFaceForColor(state, crossColor);
  const crossNormal = stickerGeometry(crossFace, 4).normal;
  const lastLayerNormal: Vec3 = [-crossNormal[0], -crossNormal[1], -crossNormal[2]];
  const lastLayerFace = faceForNormal(lastLayerNormal);
  const crossSolved = cubiesAreSolved(state, crossEdgePositions(crossNormal));
  const solvedF2lSlots = f2lSlotPositions(crossNormal).filter((slotPositions) =>
    cubiesAreSolved(state, slotPositions),
  ).length;
  const stickers = toStickers(state);
  const f2lSolved = crossSolved && solvedF2lSlots === 4;
  const ollSolved = state[lastLayerFace].every(
    (color) => color === state[lastLayerFace][4],
  );
  const pllSolved =
    ollSolved &&
    FACES.filter((face) => face !== crossFace && face !== lastLayerFace).every((face) => {
      const normal = stickerGeometry(face, 4).normal;
      const row = stickers.filter(
        (sticker) =>
          sameVector(sticker.normal, normal) &&
          dot(sticker.position, lastLayerNormal) === 1,
      );
      return row.length === 3 && row.every((sticker) => sticker.color === row[0].color);
    });
  const cubeSolved = isSolved(state);

  return { crossSolved, solvedF2lSlots, f2lSolved, ollSolved, pllSolved, cubeSolved };
}

export function derivePhase(
  state: CubeState,
  crossColor: StickerColor = "white",
): CfopPhase {
  const facts = derivePhaseFacts(state, crossColor);
  if (facts.cubeSolved) return "done";
  if (facts.f2lSolved && facts.ollSolved) return "pll";
  if (facts.f2lSolved) return "oll";
  if (facts.crossSolved) return "f2l";
  return "cross";
}
