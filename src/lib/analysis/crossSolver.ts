import {
  FACES,
  applyMove,
  createSolvedCube,
  deriveCrossEdgeCoordinates,
  derivePhaseFacts,
  type CubeState,
  type StickerColor,
} from "$lib/cube/cube";

const SUFFIXES = ["", "'", "2"] as const;
const MOVES = FACES.flatMap((face) => SUFFIXES.map((suffix) => `${face}${suffix}`));
const OPPOSITE: Record<string, string> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

function stateKey(state: CubeState, crossColor: StickerColor): string {
  return deriveCrossEdgeCoordinates(state, crossColor).map((edge) => `${edge.id}@${edge.coordinate}`).join("|");
}

const edgeDistanceCache = new Map<StickerColor, Map<string, Map<string, number>>>();

function edgeDistances(crossColor: StickerColor): Map<string, Map<string, number>> {
  const cached = edgeDistanceCache.get(crossColor);
  if (cached) return cached;
  const distances = new Map<string, Map<string, number>>();
  const solved = createSolvedCube();
  const expectedIds = deriveCrossEdgeCoordinates(solved, crossColor).map((edge) => edge.id);
  for (const id of expectedIds) distances.set(id, new Map());
  const queue: Array<{ state: CubeState; depth: number; previousFace: string | null }> = [
    { state: solved, depth: 0, previousFace: null },
  ];
  const seen = new Set<string>();
  while (queue.length > 0 && [...distances.values()].some((values) => values.size < 24)) {
    const current = queue.shift()!;
    const key = stateKey(current.state, crossColor);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const edge of deriveCrossEdgeCoordinates(current.state, crossColor)) {
      const values = distances.get(edge.id)!;
      if (!values.has(edge.coordinate)) values.set(edge.coordinate, current.depth);
    }
    if (current.depth >= 4) continue;
    for (const move of MOVES) {
      if (move[0] === current.previousFace) continue;
      queue.push({ state: applyMove(current.state, move), depth: current.depth + 1, previousFace: move[0] });
    }
  }
  edgeDistanceCache.set(crossColor, distances);
  return distances;
}

function lowerBound(state: CubeState, crossColor: StickerColor): number {
  const distances = edgeDistances(crossColor);
  const values = deriveCrossEdgeCoordinates(state, crossColor).map((edge) =>
    distances.get(edge.id)?.get(edge.coordinate) ?? 0,
  );
  return Math.max(...values, Math.ceil(values.reduce((sum, value) => sum + value, 0) / 4));
}

/** IDDFS returns an HTM-optimal cross solution up to the requested bound. */
export function solveCrossOptimal(
  state: CubeState,
  crossColor: StickerColor = "white",
  maxDepth = 8,
): string[] | null {
  if (derivePhaseFacts(state, crossColor).crossSolved) return [];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const seen = new Map<string, number>();
    const result = search(state, crossColor, depth, null, [], seen);
    if (result) return result;
  }
  return null;
}

function search(
  state: CubeState,
  crossColor: StickerColor,
  remaining: number,
  previousFace: string | null,
  path: string[],
  seen: Map<string, number>,
): string[] | null {
  if (derivePhaseFacts(state, crossColor).crossSolved) return path;
  if (remaining === 0) return null;
  if (lowerBound(state, crossColor) > remaining) return null;
  const key = stateKey(state, crossColor);
  if ((seen.get(key) ?? -1) >= remaining) return null;
  seen.set(key, remaining);

  for (const move of MOVES) {
    const face = move[0];
    if (face === previousFace) continue;
    // Opposite faces commute. Search one canonical order to avoid duplicates.
    if (previousFace && OPPOSITE[previousFace] === face && face < previousFace) continue;
    const result = search(
      applyMove(state, move),
      crossColor,
      remaining - 1,
      face,
      [...path, move],
      seen,
    );
    if (result) return result;
  }
  return null;
}
