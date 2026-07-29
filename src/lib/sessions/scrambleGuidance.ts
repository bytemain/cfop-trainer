import { applyMoves, invertMove, type CubeState } from "$lib/cube/cube";

/**
 * Scramble guidance for physical sessions: the user must follow the shown
 * sequence exactly. A wrong move diverges the physical cube from the
 * sequence; the user recovers by undoing moves until the cube matches the
 * sequence prefix again (the app verifies against the cube state), or by
 * undoing the previous step with its inverse move.
 */

export interface ScrambleFault {
  /** Sequence index the divergence happened at. */
  index: number;
  /** The move the sequence expected at that index (null past the end). */
  expected: string | null;
  /** The latest move that did not belong here. */
  got: string;
}

export type ScrambleMoveDecision =
  /** The expected move: advance one step (clearing a fault if the state matches). */
  | { kind: "advance"; clearFault: boolean }
  /** Inverse of the previous step with matching state: step back. */
  | { kind: "undo" }
  /** A faulted session returned to the sequence prefix: clear the fault. */
  | { kind: "recover" }
  /** Anything else while diverging: record/refresh the fault. */
  | { kind: "fault"; fault: ScrambleFault };

export function decideScrambleMove(params: {
  scramble: readonly string[];
  index: number;
  move: string;
  fault: ScrambleFault | null;
  /** Cube state equals base + scramble[0..index) after applying `move`. */
  stateMatchesPrefix: boolean;
  /** Cube state equals base + scramble[0..index-1) after applying `move`. */
  stateMatchesPreviousPrefix: boolean;
}): ScrambleMoveDecision {
  const { scramble, index, move, fault, stateMatchesPrefix, stateMatchesPreviousPrefix } = params;
  const expected = scramble[index] ?? null;

  // While faulted, matching the prefix means the user undid their divergence.
  if (fault && stateMatchesPrefix) {
    return move === expected ? { kind: "advance", clearFault: true } : { kind: "recover" };
  }

  if (expected !== null && move === expected) {
    return { kind: "advance", clearFault: false };
  }

  // Clean undo: the inverse of the previous step is only ambiguous with the
  // expected move when scrambles repeat a face, which generation forbids.
  if (
    !fault &&
    index > 0 &&
    move === invertMove(scramble[index - 1]) &&
    stateMatchesPreviousPrefix
  ) {
    return { kind: "undo" };
  }

  return { kind: "fault", fault: { index: fault?.index ?? index, expected, got: move } };
}

export function scramblePrefixState(
  base: CubeState,
  scramble: readonly string[],
  index: number,
): CubeState {
  return applyMoves(base, scramble.slice(0, index));
}
