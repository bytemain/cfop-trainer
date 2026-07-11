import { describe, expect, it } from "vitest";
import {
  averageQuaternions,
  createSignalCalibrationProfile,
  deriveGyroCalibrationFromSignalProfile,
  quaternionAngularDistanceDeg,
  serializeSignalCalibrationProfile,
  summarizeCompoundMotionValidation,
  summarizeDynamicAxis,
  summarizeFrameFieldEvidence,
  summarizeMoveValidation,
  summarizeStaticPose,
} from "./signalProfile";
import { multiplyQuaternions, quaternionFromAxisAngle } from "$lib/cube/orientation";

describe("signal calibration profile", () => {
  it("treats q and -q as the same pose when averaging", () => {
    const average = averageQuaternions([
      { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      { x: 0, y: -Math.SQRT1_2, z: 0, w: -Math.SQRT1_2 },
    ]);
    expect(Math.abs(average.y)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(average.w)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(quaternionAngularDistanceDeg(average, {
      x: 0, y: -Math.SQRT1_2, z: 0, w: -Math.SQRT1_2,
    })).toBeLessThan(0.00001);
  });

  it("summarizes a stable pose without retaining its raw time series", () => {
    const capture = summarizeStaticPose(
      "white",
      "green",
      Array.from({ length: 24 }, (_, index) => ({
        at: index,
        quaternion: { x: index % 2 ? 0.001 : -0.001, y: 0, z: 0, w: 1 },
      })),
    );
    expect(capture.sampleCount).toBe(24);
    expect(capture.confidence).toBeGreaterThan(0.95);
    expect(capture).not.toHaveProperty("samples");
  });

  it("rejects a static window that still contains motion", () => {
    expect(() => summarizeStaticPose(
      "white",
      "green",
      Array.from({ length: 12 }, (_, index) => ({
        at: index,
        quaternion: quaternionFromAxisAngle("x", index * 2),
      })),
    )).toThrow(/仍在移动/);
  });

  it("validates a multi-axis free-air path separately from model fitting", () => {
    const samples = [{ at: 0, quaternion: { x: 0, y: 0, z: 0, w: 1 } }];
    let current = samples[0].quaternion;
    let at = 0;
    for (const axis of ["x", "y", "z"] as const) {
      for (let index = 0; index < 30; index += 1) {
        current = multiplyQuaternions(quaternionFromAxisAngle(axis, 3), current);
        at += 10;
        samples.push({ at, quaternion: current });
      }
    }
    const summary = summarizeCompoundMotionValidation(
      samples,
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    expect(summary.pathRotationDeg).toBeCloseTo(270, 1);
    expect(Math.min(summary.axisCoverage.x, summary.axisCoverage.y, summary.axisCoverage.z)).toBeGreaterThan(0.3);
    expect(summary.passed).toBe(true);
  });

  it("detects protocol axis and sign from angular velocity", () => {
    const capture = summarizeDynamicAxis(
      "white-yellow",
      "white",
      Array.from({ length: 12 }, (_, index) => ({
        at: index,
        velocity: { x: 0.2, y: -8 - index * 0.1, z: 0.4 },
      })),
    );
    expect(capture.protocolAxis).toBe("y");
    expect(capture.sign).toBe(-1);
    expect(capture.dominance).toBeGreaterThan(0.9);
    expect(capture.signalSource).toBe("angular-velocity");
  });

  it("falls back to quaternion deltas when GAN angular velocity stays at zero", () => {
    const quaternionSamples = Array.from({ length: 31 }, (_, index) => {
      const radians = (index * 3 * Math.PI) / 180;
      return {
        at: index * 10,
        quaternion: {
          x: Math.sin(radians / 2),
          y: 0,
          z: 0,
          w: Math.cos(radians / 2),
        },
      };
    });
    const capture = summarizeDynamicAxis(
      "red-orange",
      "red",
      quaternionSamples.map((sample) => ({
        at: sample.at,
        velocity: { x: 0, y: 0, z: 0 },
      })),
      quaternionSamples,
    );
    expect(capture.protocolAxis).toBe("x");
    expect(capture.sign).toBe(1);
    expect(capture.signalSource).toBe("quaternion-delta");
    expect(capture.dominance).toBeGreaterThan(0.99);
  });

  it("validates move face and direction in order", () => {
    expect(summarizeMoveValidation(["R", "U", "R'", "U'"], ["r", "u", "r’", "u’"]).matched)
      .toBe(true);
    expect(summarizeMoveValidation(["R"], ["R'"]).matched).toBe(false);
  });

  it("derives the GAN body mapping and user zero from a complete v4 profile", () => {
    const zero = {
      w: -0.5278115896786351,
      x: -0.07567134227142988,
      y: 0.018830564884244807,
      z: 0.8457743100768033,
    };
    const derived = deriveGyroCalibrationFromSignalProfile({
      staticPoses: [
        { top: "white", front: "green", average: zero, sampleCount: 20, maxAngularDeviationDeg: 0.5, confidence: 0.95 },
        { top: "yellow", front: "blue", average: { w: -0.07250381914004346, x: 0.843315264867377, y: -0.5272494414657792, z: 0.07463636329429311 }, sampleCount: 20, maxAngularDeviationDeg: 0.5, confidence: 0.95 },
        { top: "red", front: "white", average: { w: -0.6953897816214034, x: 0.6398199192203379, y: 0.25976319649196955, z: 0.1989638266964412 }, sampleCount: 20, maxAngularDeviationDeg: 0.5, confidence: 0.95 },
        { top: "orange", front: "white", average: { w: 0.0225620855142379, x: 0.31072915910901133, y: -0.6441940235767591, z: 0.6985358988374476 }, sampleCount: 20, maxAngularDeviationDeg: 0.5, confidence: 0.95 },
        { top: "green", front: "white", average: { w: 0.4460468366589519, x: -0.13408905378342317, y: -0.6818247156503607, z: 0.5640721605347256 }, sampleCount: 20, maxAngularDeviationDeg: 0.5, confidence: 0.95 },
        { top: "blue", front: "white", average: { w: 0.4265719007035025, x: -0.6011145431200849, y: 0.22337354947622737, z: -0.6378102985795417 }, sampleCount: 20, maxAngularDeviationDeg: 0.5, confidence: 0.95 },
      ],
      dynamicAxes: [
        { physicalAxis: "red-orange", positiveFace: "red", protocolAxis: "y", sign: -1, sampleCount: 20, activeSampleCount: 10, dominance: 0.736, confidence: 0.789, signalSource: "quaternion-delta", quaternionDeltaOrder: "current-previous-inverse" },
        { physicalAxis: "blue-green", positiveFace: "blue", protocolAxis: "x", sign: -1, sampleCount: 20, activeSampleCount: 10, dominance: 0.744, confidence: 0.795, signalSource: "quaternion-delta", quaternionDeltaOrder: "current-previous-inverse" },
        { physicalAxis: "white-yellow", positiveFace: "white", protocolAxis: "z", sign: -1, sampleCount: 20, activeSampleCount: 10, dominance: 0.682, confidence: 0.746, signalSource: "quaternion-delta", quaternionDeltaOrder: "current-previous-inverse" },
      ],
    });
    expect(derived?.zero).toEqual(zero);
    expect(derived?.bodyToModel).toEqual([
      [0, -1, 0],
      [0, 0, -1],
      [1, 0, 0],
    ]);
    expect(derived?.relativeOrder).toBe("reference-current-inverse");
    expect(derived?.meanPoseErrorDeg).toBeCloseTo(18.559, 3);
    expect(derived?.valid).toBe(false);
  });

  it("refuses to persist an ambiguous axis solution", () => {
    expect(deriveGyroCalibrationFromSignalProfile({
      staticPoses: [{
        top: "white", front: "green", average: { x: 0, y: 0, z: 0, w: 1 },
        sampleCount: 20, maxAngularDeviationDeg: 0, confidence: 1,
      }],
      dynamicAxes: [
        { physicalAxis: "red-orange", positiveFace: "red", protocolAxis: "x", sign: 1, sampleCount: 20, activeSampleCount: 10, dominance: 1, confidence: 1, signalSource: "quaternion-delta" },
        { physicalAxis: "blue-green", positiveFace: "blue", protocolAxis: "x", sign: 1, sampleCount: 20, activeSampleCount: 10, dominance: 1, confidence: 1, signalSource: "quaternion-delta" },
        { physicalAxis: "white-yellow", positiveFace: "white", protocolAxis: "z", sign: 1, sampleCount: 20, activeSampleCount: 10, dominance: 1, confidence: 1, signalSource: "quaternion-delta" },
      ],
    })).toBeNull();
  });

  it("reduces in-memory frames to byte indexes instead of persisted bytes", () => {
    const evidence = summarizeFrameFieldEvidence({
      staticPoseGroups: [
        [{ at: 1, layer: "decrypted", packetType: "gyro", bytes: new Uint8Array([0xec, 1, 10, 20]) }],
        [{ at: 2, layer: "decrypted", packetType: "gyro", bytes: new Uint8Array([0xec, 1, 40, 20]) }],
      ],
      dynamicGroups: {
        "red-orange": [
          { at: 3, layer: "decrypted", packetType: "gyro", bytes: new Uint8Array([0xec, 1, 40, 2]) },
          { at: 4, layer: "decrypted", packetType: "gyro", bytes: new Uint8Array([0xec, 1, 40, 9]) },
        ],
      },
      moveFrames: [
        { at: 5, layer: "decrypted", packetType: "move", bytes: new Uint8Array([1, 4, 2]) },
        { at: 6, layer: "decrypted", packetType: "move", bytes: new Uint8Array([1, 4, 8]) },
      ],
    });
    expect(evidence.staticPoseCandidateByteIndexes).toContain(2);
    expect(evidence.dynamicCandidateByteIndexes["red-orange"]).toEqual([3]);
    expect(evidence.moveCandidateByteIndexes).toEqual([2]);
    expect(evidence).not.toHaveProperty("frames");
    expect(evidence.rawBytesPersisted).toBe(false);
  });

  it("serializes only confirmed summaries and privacy declarations", () => {
    const profile = createSignalCalibrationProfile({
      deviceModel: "GAN16ui_TEST",
      protocol: "v4",
      staticPoses: [],
      dynamicAxes: [],
      moveValidation: summarizeMoveValidation([], []),
      renderValidation: { confirmed: true },
      frameFieldEvidence: summarizeFrameFieldEvidence({
        staticPoseGroups: [], dynamicGroups: {}, moveFrames: [],
      }),
      now: new Date("2026-07-11T00:00:00.000Z"),
    });
    const json = serializeSignalCalibrationProfile(profile).toLowerCase();
    const serialized = JSON.parse(json);
    expect(serialized).not.toHaveProperty("address");
    expect(serialized).not.toHaveProperty("mac");
    expect(json).not.toContain("manufacturerdata");
    expect(json).not.toContain("rawpacket");
    expect(json).not.toContain("aes");
    expect(profile.privacy.rawBlePersisted).toBe(false);
  });
});
