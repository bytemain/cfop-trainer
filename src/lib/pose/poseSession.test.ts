import { describe, expect, it } from "vitest";
import {
  composeGyroCalibration,
  DEFAULT_DEVICE_CALIBRATION,
  DEFAULT_VIEW_PREFERENCE,
  gyroModelMatrix,
  quaternionFromAxisAngle,
} from "$lib/cube/orientation";
import { PoseSession } from "./poseSession";

describe("PoseSession", () => {
  it("restores a persisted anchor and tracks deltas from it", () => {
    const session = new PoseSession(DEFAULT_DEVICE_CALIBRATION, DEFAULT_VIEW_PREFERENCE);
    const sensorReference = quaternionFromAxisAngle("z", 20);
    const cubeReference: [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ] = [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ];
    session.restoreAnchor({ sensorReference, cubeReference, establishedAt: 123, reason: "restored" });
    const observation = session.observe(sensorReference, 1_000);
    expect(observation.accepted).toBe(true);
    expect(observation.anchor?.reason).toBe("restored");
    expect(observation.health.status).not.toBe("initializing");
    // The first frame after restore renders exactly the persisted cube pose.
    const rendered = gyroModelMatrix(
      observation.quaternion!,
      composeGyroCalibration(DEFAULT_DEVICE_CALIBRATION, observation.anchor, DEFAULT_VIEW_PREFERENCE),
    );
    expect(rendered).toEqual(cubeReference);
  });

  it("anchors the first GAN frame to its near-absolute canonical pose", () => {
    // A non-upright first frame anchors at the near-absolute pose (gravity-true
    // tilt) without snapping; an upright frame would snap to the nearest legal
    // cube orientation. Quick calibration rebinds the anchor explicitly.
    const session = new PoseSession(DEFAULT_DEVICE_CALIBRATION, DEFAULT_VIEW_PREFERENCE);
    const first = quaternionFromAxisAngle("x", 45);
    const observation = session.observe(first, 1_000);
    expect(observation.anchor?.reason).toBe("session-start");
    expect(observation.anchor?.cubeReference).toEqual(
      gyroModelMatrix(first, composeGyroCalibration(
        DEFAULT_DEVICE_CALIBRATION,
        null,
        DEFAULT_VIEW_PREFERENCE,
      )),
    );
  });

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
