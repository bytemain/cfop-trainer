import { applyMoves, type CubeState } from "$lib/cube/cube";

/**
 * Scramble guidance for physical sessions: the user follows the shown sequence.
 *
 * The GAN cube reports only quarter turns (X / X'), never a double turn (X2).
 * A scramble step like "B2" therefore arrives as two quarter turns. Decisions
 * are verified against the scramble prefix states rather than move strings, so
 * a double turn advances only once both quarter turns land on the X2 state (in
 * either turn direction), and the first quarter turn is held — not faulted —
 * while the turn completes.
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
  /** The cube reached the next prefix state: advance one step. */
  | { kind: "advance"; clearFault: boolean }
  /** The cube returned to the previous prefix state: step back. */
  | { kind: "undo" }
  /** A faulted cube returned to the current prefix state: clear the fault. */
  | { kind: "recover" }
  /** First quarter turn of a double turn: wait for the completing quarter turn. */
  | { kind: "hold" }
  /** Anything else while diverging: record/refresh the fault. */
  | { kind: "fault"; fault: ScrambleFault };

export function decideScrambleMove(params: {
  scramble: readonly string[];
  index: number;
  move: string;
  fault: ScrambleFault | null;
  /** Cube state after `move` equals base + scramble[0..index+1). */
  matchesNextPrefix: boolean;
  /** Cube state after `move` equals base + scramble[0..index). */
  matchesCurrentPrefix: boolean;
  /** Cube state after `move` equals base + scramble[0..index-1). */
  matchesPreviousPrefix: boolean;
}): ScrambleMoveDecision {
  const {
    scramble,
    index,
    move,
    fault,
    matchesNextPrefix,
    matchesCurrentPrefix,
    matchesPreviousPrefix,
  } = params;
  const expected = scramble[index] ?? null;
  const previous = index > 0 ? scramble[index - 1] : null;

  // Advancement: the cube reached the next prefix state. State-verified, so a
  // double turn advances only after both quarter turns complete the X2 state.
  if (expected !== null && matchesNextPrefix) {
    return { kind: "advance", clearFault: fault !== null };
  }

  // Undo: the cube returned to the previous prefix state. For a double turn
  // this is only true after both quarter turns unwind the X2.
  if (!fault && previous !== null && matchesPreviousPrefix) {
    return { kind: "undo" };
  }

  // Halfway through a double turn (advancing or undoing): the first quarter
  // turn leaves the cube one quarter from a prefix. Hold for the completing
  // quarter turn instead of flagging a fault.
  if (!fault && isDoubleTurnHalfway(expected, previous, move)) {
    return { kind: "hold" };
  }

  // Fault recovery: the faulted cube returned to the current prefix state, so
  // the divergence has been undone.
  if (fault && matchesCurrentPrefix) {
    return { kind: "recover" };
  }

  return { kind: "fault", fault: { index: fault?.index ?? index, expected, got: move } };
}

/**
 * True when `move` is a quarter turn of a face whose expected or previous
 * scramble step is a double turn — i.e. the first half of an in-progress X2.
 */
function isDoubleTurnHalfway(
  expected: string | null,
  previous: string | null,
  move: string,
): boolean {
  if (move.endsWith("2")) return false; // the cube never reports a double turn
  const face = move[0];
  return expected === `${face}2` || previous === `${face}2`;
}

export function scramblePrefixState(
  base: CubeState,
  scramble: readonly string[],
  index: number,
): CubeState {
  return applyMoves(base, scramble.slice(0, index));
}
