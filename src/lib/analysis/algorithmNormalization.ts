import { normalizeMove } from "$lib/cube/cube";

const ROTATIONS: Record<"x" | "y" | "z", Record<string, string>> = {
  x: { U: "B", B: "D", D: "F", F: "U", R: "R", L: "L" },
  y: { F: "L", L: "B", B: "R", R: "F", U: "U", D: "D" },
  z: { U: "R", R: "D", D: "L", L: "U", F: "F", B: "B" },
};

function quarterTurns(token: string): number {
  return token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1;
}

export function normalizeCubeRotations(tokens: readonly string[]): string[] {
  let mapping: Record<string, string> = { U: "U", R: "R", F: "F", D: "D", L: "L", B: "B" };
  const result: string[] = [];
  for (const raw of tokens) {
    const token = raw.trim().replace(/’/g, "'");
    const rotation = token[0].toLowerCase();
    if (rotation === "x" || rotation === "y" || rotation === "z") {
      for (let turn = 0; turn < quarterTurns(token); turn += 1) {
        mapping = Object.fromEntries(Object.entries(mapping).map(([viewFace, canonicalFace]) => [
          viewFace,
          ROTATIONS[rotation][canonicalFace],
        ]));
      }
      continue;
    }
    if (!/^[URFDLB]/i.test(token)) continue;
    const canonicalFace = mapping[token[0].toUpperCase()];
    result.push(normalizeMove(`${canonicalFace}${token.slice(1)}`));
  }
  return result;
}

function reduceSameFace(tokens: readonly string[]): string[] {
  const stack: Array<{ face: string; turns: number }> = [];
  for (const token of tokens) {
    const move = normalizeMove(token);
    const face = move[0];
    const turns = move.endsWith("2") ? 2 : move.endsWith("'") ? 3 : 1;
    const previous = stack.at(-1);
    if (previous?.face === face) {
      previous.turns = (previous.turns + turns) % 4;
      if (previous.turns === 0) stack.pop();
    } else stack.push({ face, turns });
  }
  return stack.map(({ face, turns }) => `${face}${turns === 2 ? "2" : turns === 3 ? "'" : ""}`);
}

export function normalizeAufAndRotations(tokens: readonly string[]): { core: string[]; preAuf: number; postAuf: number } {
  const normalized = reduceSameFace(normalizeCubeRotations(tokens));
  let preAuf = 0;
  let postAuf = 0;
  while (normalized[0]?.startsWith("U")) preAuf = (preAuf + quarterTurns(normalized.shift()!)) % 4;
  while (normalized.at(-1)?.startsWith("U")) postAuf = (postAuf + quarterTurns(normalized.pop()!)) % 4;
  return { core: normalized, preAuf, postAuf };
}

export function compareAlgorithms(actual: readonly string[], recommended: readonly string[]) {
  const left = normalizeAufAndRotations(actual);
  const right = normalizeAufAndRotations(recommended);
  const exactCore = left.core.join(" ") === right.core.join(" ");
  return {
    equivalentIgnoringAufAndRotations: exactCore,
    actual: left,
    recommended: right,
    extraCoreMoves: Math.max(0, left.core.length - right.core.length),
  };
}
