export function reliableSnapshotMoveSequence(
  sequence: number | null | undefined,
): number | null {
  // GAN16ui V4 uses zero both for an unknown/omitted 0xED counter and for a
  // real first 0x01 move. A zero snapshot value therefore cannot prove that
  // move sequence zero has already been consumed.
  return sequence === null || sequence === undefined || sequence === 0
    ? null
    : sequence;
}
