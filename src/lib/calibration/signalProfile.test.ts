import { describe, expect, it } from "vitest";
import {
  averageQuaternions,
  createSignalCalibrationProfile,
  quaternionAngularDistanceDeg,
  serializeSignalCalibrationProfile,
  summarizeDynamicAxis,
  summarizeFrameFieldEvidence,
  summarizeMoveValidation,
  summarizeStaticPose,
} from "./signalProfile";

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
  });

  it("validates move face and direction in order", () => {
    expect(summarizeMoveValidation(["R", "U", "R'", "U'"], ["r", "u", "r’", "u’"]).matched)
      .toBe(true);
    expect(summarizeMoveValidation(["R"], ["R'"]).matched).toBe(false);
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
