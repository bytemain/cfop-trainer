import type { CubeState } from "$lib/cube/cube";

export type MoveSource = "live" | "history" | "demo";

export interface MoveTimelineEntry {
  kind: "move";
  sequence: number;
  move: string;
  source: MoveSource;
  cubeTime: number | null;
  hostReceivedAt: number;
  estimatedHostTime: number | null;
  stateBefore: CubeState;
  stateAfter: CubeState;
}

export interface TimelineDiscontinuity {
  kind: "discontinuity";
  afterSequence: number | null;
  snapshotSequence: number | null;
  hostReceivedAt: number;
  reason: string;
}

export type MoveTimelineItem = MoveTimelineEntry | TimelineDiscontinuity;

export class MoveTimeline {
  private items: MoveTimelineItem[] = [];

  appendMove(entry: Omit<MoveTimelineEntry, "kind">): MoveTimelineEntry {
    const value: MoveTimelineEntry = { kind: "move", ...entry };
    this.items.push(value);
    return value;
  }

  markDiscontinuity(
    reason: string,
    afterSequence: number | null,
    snapshotSequence: number | null,
    hostReceivedAt = Date.now(),
  ): TimelineDiscontinuity {
    const value: TimelineDiscontinuity = {
      kind: "discontinuity",
      reason,
      afterSequence,
      snapshotSequence,
      hostReceivedAt,
    };
    this.items.push(value);
    return value;
  }

  reset(): void {
    this.items = [];
  }

  snapshot(): readonly MoveTimelineItem[] {
    return this.items;
  }

  movesSinceLastDiscontinuity(): readonly MoveTimelineEntry[] {
    const boundary = this.items.findLastIndex((item) => item.kind === "discontinuity");
    return this.items.slice(boundary + 1).filter(
      (item): item is MoveTimelineEntry => item.kind === "move",
    );
  }
}
