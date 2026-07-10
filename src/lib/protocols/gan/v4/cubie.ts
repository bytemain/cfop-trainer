const CORNER_FACELETS = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51],
] as const;

const CORNER_COLORS = [
  ["U", "R", "F"],
  ["U", "F", "L"],
  ["U", "L", "B"],
  ["U", "B", "R"],
  ["D", "F", "R"],
  ["D", "L", "F"],
  ["D", "B", "L"],
  ["D", "R", "B"],
] as const;

const EDGE_FACELETS = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14],
] as const;

const EDGE_COLORS = [
  ["U", "R"],
  ["U", "F"],
  ["U", "L"],
  ["U", "B"],
  ["D", "R"],
  ["D", "F"],
  ["D", "L"],
  ["D", "B"],
  ["F", "R"],
  ["F", "L"],
  ["B", "L"],
  ["B", "R"],
] as const;

export interface GanCubieState {
  corners: Uint8Array;
  edges: Uint8Array;
}

export function verifyCubieState({ corners, edges }: GanCubieState): boolean {
  if (corners.length !== 8 || edges.length !== 12) return false;

  const cornerPermutations = [...corners].map((value) => value & 0x7);
  const edgePermutations = [...edges].map((value) => value >> 1);
  if (new Set(cornerPermutations).size !== 8 || cornerPermutations.some((value) => value > 7)) {
    return false;
  }
  if (new Set(edgePermutations).size !== 12 || edgePermutations.some((value) => value > 11)) {
    return false;
  }

  const cornerOrientation = [...corners].reduce((sum, value) => sum + (value >> 3), 0);
  const edgeOrientation = [...edges].reduce((sum, value) => sum + (value & 1), 0);
  return cornerOrientation % 3 === 0 && edgeOrientation % 2 === 0;
}

export function cubieStateToFacelets(state: GanCubieState): string {
  if (!verifyCubieState(state)) throw new Error("GAN cube returned an invalid cubie state");

  const facelets = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB".split("");

  for (let position = 0; position < 8; position += 1) {
    const cubie = state.corners[position] & 0x7;
    const orientation = state.corners[position] >> 3;
    for (let sticker = 0; sticker < 3; sticker += 1) {
      facelets[CORNER_FACELETS[position][(sticker + orientation) % 3]] =
        CORNER_COLORS[cubie][sticker];
    }
  }

  for (let position = 0; position < 12; position += 1) {
    const cubie = state.edges[position] >> 1;
    const orientation = state.edges[position] & 1;
    for (let sticker = 0; sticker < 2; sticker += 1) {
      facelets[EDGE_FACELETS[position][(sticker + orientation) % 2]] = EDGE_COLORS[cubie][sticker];
    }
  }

  return facelets.join("");
}
