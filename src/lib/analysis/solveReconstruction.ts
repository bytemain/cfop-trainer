import {
  FACES,
  applyMove,
  applyMoves,
  cloneCube,
  createSolvedCube,
  derivePhaseFacts,
  deriveF2lSlotFacts,
  invertAlgorithm,
  rotateCube,
  type CubeState,
  type StickerColor,
} from "$lib/cube/cube";
import type { MoveTimelineEntry, MoveTimelineItem } from "$lib/timeline/moveTimeline";
import { compareAlgorithms } from "./algorithmNormalization";

export type ReconstructionPhase = "cross" | "f2l" | "oll" | "pll";

export interface PhaseSplit {
  phase: ReconstructionPhase;
  startMoveIndex: number;
  endMoveIndex: number;
  moveCount: number;
  durationMs: number | null;
  tps: number | null;
  pauses: Array<{ afterMoveIndex: number; durationMs: number }>;
}

export interface RecognizedCase {
  kind: "oll" | "pll";
  id: string;
  name: string;
  auf: 0 | 1 | 2 | 3;
  confidence: "exact" | "signature-only";
  recommendedAlgorithm?: string[];
}

export interface SolveReconstruction {
  continuous: boolean;
  complete: boolean;
  moves: readonly MoveTimelineEntry[];
  boundaries: { cross: number; f2l: number; oll: number; solved: number } | null;
  splits: PhaseSplit[];
  ollCase: RecognizedCase | null;
  pllCase: RecognizedCase | null;
  totalDurationMs: number | null;
  totalTps: number | null;
  pauseCount: number;
  moveEfficiency: {
    rawHtm: number;
    cancellationReducedHtm: number;
    avoidableMoves: number;
  };
  algorithmComparisons: Array<{
    phase: "oll" | "pll";
    equivalentIgnoringAufAndRotations: boolean;
    extraCoreMoves: number;
    recommended: string[];
  }>;
  f2lPairs: Array<{ id: string; completedAtMove: number | null; durationFromPreviousMs: number | null }>;
  replayStates: CubeState[];
}

const KNOWN_CASE_ALGORITHMS: Array<{ kind: "oll" | "pll"; id: string; name: string; algorithm: string[] }> = [
  { kind: "oll", id: "oll-21", name: "H", algorithm: "R U2 R' U' R U R' U' R U' R'".split(" ") },
  { kind: "oll", id: "oll-22", name: "Pi", algorithm: "R U2 R2 U' R2 U' R2 U2 R".split(" ") },
  { kind: "oll", id: "oll-26", name: "Anti-Sune", algorithm: "R U2 R' U' R U' R'".split(" ") },
  { kind: "oll", id: "oll-27", name: "Sune", algorithm: "R U R' U R U2 R'".split(" ") },
  { kind: "pll", id: "pll-t", name: "T Perm", algorithm: "R U R' U' R' F R2 U' R' U' R U R' F'".split(" ") },
  { kind: "pll", id: "pll-y", name: "Y Perm", algorithm: "F R U' R' U' R U R' F' R U R' U' R' F R F'".split(" ") },
];

function serializeRelativeToCenters(state: CubeState): string {
  const colorToFace = new Map<StickerColor, string>(FACES.map((face) => [state[face][4], face]));
  return FACES.flatMap((face) => state[face].map((color) => colorToFace.get(color) ?? "?")).join("");
}

function allCubeOrientations(state: CubeState): CubeState[] {
  const result: CubeState[] = [];
  const queue = [cloneCube(state)];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const centerKey = FACES.map((face) => current[face][4]).join("/");
    if (seen.has(centerKey)) continue;
    seen.add(centerKey);
    result.push(current);
    queue.push(rotateCube(current, "x"), rotateCube(current, "y"), rotateCube(current, "z"));
  }
  return result;
}

function caseSignatures(
  kind: "oll" | "pll",
  state: CubeState,
  crossColor: StickerColor,
): Array<{ signature: string; auf: 0 | 1 | 2 | 3 }> {
  const values: Array<{ signature: string; auf: 0 | 1 | 2 | 3 }> = [];
  for (const oriented of allCubeOrientations(state).filter((candidate) => candidate.D[4] === crossColor)) {
    let current = cloneCube(oriented);
    for (let auf = 0; auf < 4; auf += 1) {
      const signature = kind === "oll"
        ? FACES.flatMap((face) => current[face].map((color) => color === current.U[4] ? "1" : "0")).join("")
        : serializeRelativeToCenters(current);
      values.push({ signature, auf: auf as 0 | 1 | 2 | 3 });
      current = applyMove(current, "U");
    }
  }
  return values;
}

const CASE_SIGNATURES = KNOWN_CASE_ALGORITHMS.flatMap((item) => {
  const whiteCrossDown = rotateCube(createSolvedCube(), "x2");
  const caseState = applyMoves(whiteCrossDown, invertAlgorithm(item.algorithm));
  return caseSignatures(item.kind, caseState, "white").map(({ signature, auf }) => ({ ...item, signature, auf }));
});

export function recognizeCfopCase(
  kind: "oll" | "pll",
  state: CubeState,
  crossColor: StickerColor = "white",
): RecognizedCase {
  for (const candidate of caseSignatures(kind, state, crossColor)) {
    const known = CASE_SIGNATURES.find((item) => item.kind === kind && item.signature === candidate.signature);
    if (known) return {
      kind,
      id: known.id,
      name: known.name,
      auf: candidate.auf,
      confidence: "exact",
      recommendedAlgorithm: known.algorithm,
    };
  }
  const canonical = caseSignatures(kind, state, crossColor).sort((left, right) => left.signature.localeCompare(right.signature))[0];
  let hash = 2166136261;
  for (const character of canonical.signature) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return {
    kind,
    id: `${kind}-signature-${(hash >>> 0).toString(16).padStart(8, "0")}`,
    name: "未命名状态",
    auf: canonical.auf,
    confidence: "signature-only",
  };
}

function firstStableBoundary(
  moves: readonly MoveTimelineEntry[],
  predicate: (state: CubeState) => boolean,
  endExclusive: number,
): number {
  for (let index = 0; index < endExclusive; index += 1) {
    if (!predicate(moves[index].stateAfter)) continue;
    let staysValid = true;
    for (let later = index + 1; later < endExclusive; later += 1) {
      if (!predicate(moves[later].stateAfter)) {
        staysValid = false;
        break;
      }
    }
    if (staysValid) return index + 1;
  }
  return endExclusive;
}

function durationBetween(moves: readonly MoveTimelineEntry[], start: number, end: number): number | null {
  if (end <= start || moves.length === 0) return 0;
  const first = moves[start]?.cubeTime;
  const last = moves[end - 1]?.cubeTime;
  return first !== null && first !== undefined && last !== null && last !== undefined
    ? Math.max(0, last - first)
    : null;
}

function createSplit(
  phase: ReconstructionPhase,
  moves: readonly MoveTimelineEntry[],
  start: number,
  end: number,
): PhaseSplit {
  const durationMs = durationBetween(moves, start, end);
  const pauses: PhaseSplit["pauses"] = [];
  for (let index = Math.max(start + 1, 1); index < end; index += 1) {
    const previous = moves[index - 1].cubeTime;
    const current = moves[index].cubeTime;
    if (previous !== null && current !== null && current - previous >= 700) {
      pauses.push({ afterMoveIndex: index - 1, durationMs: current - previous });
    }
  }
  return {
    phase,
    startMoveIndex: start,
    endMoveIndex: end,
    moveCount: Math.max(0, end - start),
    durationMs,
    tps: durationMs && durationMs > 0 ? Number(((end - start) / (durationMs / 1_000)).toFixed(2)) : null,
    pauses,
  };
}

function reduceSameFaceMoves(moves: readonly MoveTimelineEntry[]): number {
  const stack: Array<{ face: string; turns: number }> = [];
  for (const entry of moves) {
    const face = entry.move[0];
    const turns = entry.move.endsWith("2") ? 2 : entry.move.endsWith("'") ? 3 : 1;
    const previous = stack.at(-1);
    if (previous?.face === face) {
      previous.turns = (previous.turns + turns) % 4;
      if (previous.turns === 0) stack.pop();
    } else {
      stack.push({ face, turns });
    }
  }
  return stack.length;
}

function stateAtBoundary(moves: readonly MoveTimelineEntry[], boundary: number): CubeState {
  return boundary === 0 ? moves[0].stateBefore : moves[boundary - 1].stateAfter;
}

export function reconstructSolve(
  items: readonly MoveTimelineItem[],
  crossColor: StickerColor = "white",
): SolveReconstruction {
  const continuous = !items.some((item) => item.kind === "discontinuity");
  const moves = items.filter((item): item is MoveTimelineEntry => item.kind === "move");
  const complete = continuous && moves.length > 0 && derivePhaseFacts(moves.at(-1)!.stateAfter, crossColor).cubeSolved;
  const replayStates = moves.length ? [cloneCube(moves[0].stateBefore), ...moves.map((move) => cloneCube(move.stateAfter))] : [];
  if (!complete) {
    const reduced = reduceSameFaceMoves(moves);
    return {
      continuous,
      complete,
      moves,
      boundaries: null,
      splits: [],
      ollCase: null,
      pllCase: null,
      totalDurationMs: durationBetween(moves, 0, moves.length),
      totalTps: null,
      pauseCount: 0,
      moveEfficiency: { rawHtm: moves.length, cancellationReducedHtm: reduced, avoidableMoves: moves.length - reduced },
      algorithmComparisons: [],
      f2lPairs: [],
      replayStates,
    };
  }

  const solved = moves.length;
  const cross = firstStableBoundary(moves, (state) => derivePhaseFacts(state, crossColor).crossSolved, solved);
  const f2l = firstStableBoundary(moves, (state) => derivePhaseFacts(state, crossColor).f2lSolved, solved);
  const oll = firstStableBoundary(moves, (state) => {
    const facts = derivePhaseFacts(state, crossColor);
    return facts.f2lSolved && facts.ollSolved;
  }, solved);
  const splits = [
    createSplit("cross", moves, 0, cross),
    createSplit("f2l", moves, cross, f2l),
    createSplit("oll", moves, f2l, oll),
    createSplit("pll", moves, oll, solved),
  ];
  const totalDurationMs = durationBetween(moves, 0, solved);
  const reduced = reduceSameFaceMoves(moves);
  const ollCase = f2l < moves.length ? recognizeCfopCase("oll", stateAtBoundary(moves, f2l), crossColor) : null;
  const pllCase = oll < moves.length ? recognizeCfopCase("pll", stateAtBoundary(moves, oll), crossColor) : null;
  const algorithmComparisons: SolveReconstruction["algorithmComparisons"] = [];
  if (ollCase?.recommendedAlgorithm) {
    const comparison = compareAlgorithms(moves.slice(f2l, oll).map((item) => item.move), ollCase.recommendedAlgorithm);
    algorithmComparisons.push({ phase: "oll", ...comparison, recommended: ollCase.recommendedAlgorithm });
  }
  if (pllCase?.recommendedAlgorithm) {
    const comparison = compareAlgorithms(moves.slice(oll, solved).map((item) => item.move), pllCase.recommendedAlgorithm);
    algorithmComparisons.push({ phase: "pll", ...comparison, recommended: pllCase.recommendedAlgorithm });
  }
  const slotIds = deriveF2lSlotFacts(stateAtBoundary(moves, f2l), crossColor).map((slot) => slot.id);
  let previousPairMove = cross;
  const f2lPairs = slotIds.map((id) => {
    let completedAtMove: number | null = null;
    for (let index = cross; index < f2l; index += 1) {
      const current = deriveF2lSlotFacts(moves[index].stateAfter, crossColor).find((slot) => slot.id === id);
      if (!current?.solved) continue;
      const staysSolved = moves.slice(index + 1, f2l).every((entry) =>
        deriveF2lSlotFacts(entry.stateAfter, crossColor).find((slot) => slot.id === id)?.solved,
      );
      if (staysSolved) {
        completedAtMove = index + 1;
        break;
      }
    }
    const durationFromPreviousMs = completedAtMove === null
      ? null
      : durationBetween(moves, previousPairMove, completedAtMove);
    if (completedAtMove !== null) previousPairMove = completedAtMove;
    return { id, completedAtMove, durationFromPreviousMs };
  }).sort((left, right) => (left.completedAtMove ?? Number.MAX_SAFE_INTEGER) - (right.completedAtMove ?? Number.MAX_SAFE_INTEGER));
  return {
    continuous,
    complete,
    moves,
    boundaries: { cross, f2l, oll, solved },
    splits,
    ollCase,
    pllCase,
    totalDurationMs,
    totalTps: totalDurationMs && totalDurationMs > 0 ? Number((moves.length / (totalDurationMs / 1_000)).toFixed(2)) : null,
    pauseCount: splits.reduce((sum, split) => sum + split.pauses.length, 0),
    moveEfficiency: { rawHtm: moves.length, cancellationReducedHtm: reduced, avoidableMoves: moves.length - reduced },
    algorithmComparisons,
    f2lPairs,
    replayStates,
  };
}
