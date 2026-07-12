import { describe, expect, it } from "vitest";
import { reliableSnapshotMoveSequence } from "./sequence";

describe("GAN snapshot move baseline", () => {
  it("treats a zero snapshot counter as unknown but preserves non-zero counters", () => {
    expect(reliableSnapshotMoveSequence(undefined)).toBeNull();
    expect(reliableSnapshotMoveSequence(null)).toBeNull();
    expect(reliableSnapshotMoveSequence(0)).toBeNull();
    expect(reliableSnapshotMoveSequence(1)).toBe(1);
    expect(reliableSnapshotMoveSequence(0xffff)).toBe(0xffff);
  });
});
