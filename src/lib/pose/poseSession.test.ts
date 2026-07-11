import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_CALIBRATION, DEFAULT_VIEW_PREFERENCE, quaternionFromAxisAngle } from "$lib/cube/orientation";
import { PoseSession } from "./poseSession";

describe("PoseSession", () => {
  it("rejects an impossible in-cadence jump", () => {
    const session = new PoseSession(DEFAULT_DEVICE_CALIBRATION, DEFAULT_VIEW_PREFERENCE);
    expect(session.observe(quaternionFromAxisAngle("x", 0), 1_000).accepted).toBe(true);
    const jump = session.observe(quaternionFromAxisAngle("x", 150), 1_090);
    expect(jump.accepted).toBe(false);
    expect(jump.health.status).toBe("discontinuity");
  });

  it("reanchors after a long gap without changing the last canonical pose", () => {
    const session = new PoseSession(DEFAULT_DEVICE_CALIBRATION, DEFAULT_VIEW_PREFERENCE);
    session.observe(quaternionFromAxisAngle("y", 20), 1_000);
    const resumed = session.observe(quaternionFromAxisAngle("z", 170), 5_000);
    expect(resumed.accepted).toBe(true);
    expect(resumed.health.status).toBe("reanchored");
    expect(resumed.anchor?.reason).toBe("sensor-reset");
  });

  it("treats q and -q as the same continuous orientation", () => {
    const session = new PoseSession(DEFAULT_DEVICE_CALIBRATION, DEFAULT_VIEW_PREFERENCE);
    session.observe({ x: 0, y: 0, z: 0, w: 1 }, 1_000);
    const next = session.observe({ x: 0, y: 0, z: 0, w: -1 }, 1_090);
    expect(next.accepted).toBe(true);
    expect(next.health.lastStepDeg).toBeCloseTo(0);
  });
});
