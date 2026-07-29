import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion } from "three";
import {
  applyMatrix3,
  CUBE_POSE_GROUP,
  DEFAULT_GYRO_CALIBRATION,
  gyroModelMatrix,
  multiplyMatrix3,
  quaternionMatrix,
  quaternionFromAxisAngle,
  rotationDistanceDeg,
  snapToCubePose,
  transposeMatrix3,
  DEFAULT_DEVICE_CALIBRATION,
  GAN_V4_BODY_TO_MODEL,
  GAN_V4_IDENTITY_SENSOR_POSE,
  GAN_V4_POSE_CONTRACT_VERSION,
  GAN_V4_RELATIVE_ORDER,
  migrateGanV4ViewPreference,
  type Matrix3,
} from "./orientation";
import type { CubeQuaternion } from "$lib/protocols/gan/types";

function expectIdentity(model: Matrix3): void {
  const identity: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      expect(model[row][column]).toBeCloseTo(identity[row][column], 6);
    }
  }
}

// Build a sensor quaternion whose contract delta from `zeroReading` equals
// the given model-space rotation:
// B · (zero · q⁻¹) · Bᵀ = pose  =>  q = Bᵀ · poseᵀ · B · zero.
function sensorReadingAtDelta(pose: Matrix3, zeroReading: CubeQuaternion): CubeQuaternion {
  const matrix = multiplyMatrix3(
    multiplyMatrix3(
      multiplyMatrix3(transposeMatrix3(GAN_V4_BODY_TO_MODEL), transposeMatrix3(pose)),
      GAN_V4_BODY_TO_MODEL,
    ),
    quaternionMatrix(zeroReading),
  );
  const three = new Quaternion().setFromRotationMatrix(
    new Matrix4().set(
      matrix[0][0], matrix[0][1], matrix[0][2], 0,
      matrix[1][0], matrix[1][1], matrix[1][2], 0,
      matrix[2][0], matrix[2][1], matrix[2][2], 0,
      0, 0, 0, 1,
    ),
  );
  return { x: three.x, y: three.y, z: three.z, w: three.w };
}

describe("GAN orientation mapping", () => {
  it("ships the verified GAN V4 pose contract as the runtime default", () => {
    expect(DEFAULT_DEVICE_CALIBRATION.bodyToModel).toEqual(GAN_V4_BODY_TO_MODEL);
    expect(DEFAULT_DEVICE_CALIBRATION.relativeOrder).toBe(GAN_V4_RELATIVE_ORDER);
    expect(GAN_V4_BODY_TO_MODEL).toEqual([[0, -1, 0], [0, 0, -1], [1, 0, 0]]);
  });

  it("clears unversioned legacy axis compensation exactly once", () => {
    const legacy = {
      offsetX: 17,
      offsetY: -31,
      offsetZ: 8,
      invertX: true,
      invertY: false,
      invertZ: true,
    };
    expect(migrateGanV4ViewPreference(undefined, legacy)).toEqual({
      preference: {
        offsetX: 0,
        offsetY: 0,
        offsetZ: 0,
        invertX: false,
        invertY: false,
        invertZ: false,
      },
      migrated: true,
    });
    expect(migrateGanV4ViewPreference(GAN_V4_POSE_CONTRACT_VERSION, legacy)).toEqual({
      preference: legacy,
      migrated: false,
    });
  });

  const whiteUpGreenFrontFixture = GAN_V4_IDENTITY_SENSOR_POSE;
  const yellowUpBlueFrontFixture = {
    w: -0.07250381914004346,
    x: 0.843315264867377,
    y: -0.5272494414657792,
    z: 0.07463636329429311,
  };

  it("maps controlled white/green and yellow/blue captures to a model X half-turn", () => {
    const model = gyroModelMatrix(yellowUpBlueFrontFixture, {
      ...DEFAULT_GYRO_CALIBRATION,
      zero: whiteUpGreenFrontFixture,
      bodyToModel: GAN_V4_BODY_TO_MODEL,
    })!;
    expect(model[0][0]).toBeGreaterThan(0.98);
    expect(model[1][1]).toBeLessThan(-0.98);
    expect(model[2][2]).toBeLessThan(-0.98);
  });

  it("derives the near-absolute pose from the fixed contract without an anchor", () => {
    // No session anchor: the identity-grip model constant is the reference.
    // The real-device white-up/green-front reading renders as identity...
    expectIdentity(gyroModelMatrix(whiteUpGreenFrontFixture, DEFAULT_GYRO_CALIBRATION)!);
    // ...and a yellow-up/blue-front reading renders as a model X half-turn.
    const halfTurn = gyroModelMatrix(yellowUpBlueFrontFixture, DEFAULT_GYRO_CALIBRATION)!;
    expect(halfTurn[0][0]).toBeGreaterThan(0.98);
    expect(halfTurn[1][1]).toBeLessThan(-0.98);
    expect(halfTurn[2][2]).toBeLessThan(-0.98);
  });

  it("keeps world-axis turns on their world axis for arbitrary connection grips", () => {
    // Regression: composing the reference pose on the left (reference * delta)
    // expressed deltas in the body frame, so a physical X turn rendered as Y
    // whenever the session started away from the identity grip.
    // Regression: the displayed pose must track the physical pose relative
    // to the anchored grip, so a physical world-axis turn from any connection
    // grip stays on that world axis.
    const baseReading = whiteUpGreenFrontFixture;
    const connectionPose = quaternionMatrix(quaternionFromAxisAngle("y", 40));
    const worldXTurn = quaternionMatrix(quaternionFromAxisAngle("x", 30));
    const turnedPose = multiplyMatrix3(worldXTurn, connectionPose);
    const calibration = {
      ...DEFAULT_GYRO_CALIBRATION,
      zero: sensorReadingAtDelta(connectionPose, baseReading),
      referencePose: connectionPose,
      bodyToModel: GAN_V4_BODY_TO_MODEL,
      relativeOrder: GAN_V4_RELATIVE_ORDER,
    };

    const model = gyroModelMatrix(sensorReadingAtDelta(turnedPose, baseReading), calibration)!;
    expect(rotationDistanceDeg(model, turnedPose)).toBeLessThan(1e-6);

    // The on-screen delta since connection is a pure world-X rotation.
    const delta = multiplyMatrix3(model, transposeMatrix3(connectionPose));
    expect(delta[0][0]).toBeCloseTo(1, 6);
    expect(delta[1][1]).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(delta[2][2]).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(delta[2][1]).toBeCloseTo(0.5, 6);
    expect(delta[1][2]).toBeCloseTo(-0.5, 6);
  });

  it("uses the calibration pose as an identity orientation", () => {
    expectIdentity(
      gyroModelMatrix(whiteUpGreenFrontFixture, {
        ...DEFAULT_GYRO_CALIBRATION,
        zero: whiteUpGreenFrontFixture,
      })!,
    );
  });

  it("maps the captured red-orange whole-cube turn to the model X axis", () => {
    const start = {
      x: -0.000946073793755913,
      y: -0.002044740134891812,
      z: -0.6023743400372326,
      w: 0.7981810968352305,
    };
    const end = {
      x: 0.6464430677205725,
      y: -0.6256904812768944,
      z: -0.3562425611133152,
      w: 0.2522965178380688,
    };
    const model = gyroModelMatrix(end, {
      ...DEFAULT_GYRO_CALIBRATION,
      zero: start,
      bodyToModel: GAN_V4_BODY_TO_MODEL,
    })!;
    expect(model[0][0]).toBeGreaterThan(0.9);
    expect(Math.abs(model[1][0])).toBeLessThan(0.4);
    expect(Math.abs(model[2][0])).toBeLessThan(0.4);
  });

  it("renders positive physical whole-cube rotations as positive model rotations", () => {
    const identityReading = { x: 0, y: 0, z: 0, w: 1 };
    const calibration = {
      ...DEFAULT_GYRO_CALIBRATION,
      zero: identityReading,
      bodyToModel: GAN_V4_BODY_TO_MODEL,
      relativeOrder: GAN_V4_RELATIVE_ORDER,
    };
    const redAxis = gyroModelMatrix(
      sensorReadingAtDelta(quaternionMatrix(quaternionFromAxisAngle("x", 30)), identityReading),
      calibration,
    );
    const whiteAxis = gyroModelMatrix(
      sensorReadingAtDelta(quaternionMatrix(quaternionFromAxisAngle("y", 30)), identityReading),
      calibration,
    );
    const greenAxis = gyroModelMatrix(
      sensorReadingAtDelta(quaternionMatrix(quaternionFromAxisAngle("z", 30)), identityReading),
      calibration,
    );

    // +X/red sends +Y/white toward +Z/green.
    expect(applyMatrix3(redAxis!, [0, 1, 0])[2]).toBeCloseTo(0.5, 6);
    // +Y/white sends +Z/green toward +X/red.
    expect(applyMatrix3(whiteAxis!, [0, 0, 1])[0]).toBeCloseTo(0.5, 6);
    // +Z/green sends +X/red toward +Y/white.
    expect(applyMatrix3(greenAxis!, [1, 0, 0])[1]).toBeCloseTo(0.5, 6);
  });

  it("treats relative quaternion order as explicit calibration data", () => {
    const currentReference = gyroModelMatrix(
        {
          x: 0,
          y: -Math.sin(Math.PI / 12),
          z: 0,
          w: Math.cos(Math.PI / 12),
        },
        {
          ...DEFAULT_GYRO_CALIBRATION,
          zero: { x: 0, y: 0, z: 0, w: 1 },
          bodyToModel: GAN_V4_BODY_TO_MODEL,
          relativeOrder: "current-reference-inverse",
        },
    );
    const referenceCurrent = gyroModelMatrix(
        {
          x: 0,
          y: -Math.sin(Math.PI / 12),
          z: 0,
          w: Math.cos(Math.PI / 12),
        },
        {
          ...DEFAULT_GYRO_CALIBRATION,
          zero: { x: 0, y: 0, z: 0, w: 1 },
          bodyToModel: GAN_V4_BODY_TO_MODEL,
          relativeOrder: "reference-current-inverse",
        },
    );
    expect(currentReference?.[2][1]).toBeCloseTo(0.5, 6);
    expect(currentReference?.[1][2]).toBeCloseTo(-0.5, 6);
    expect(referenceCurrent?.[2][1]).toBeCloseTo(-0.5, 6);
    expect(referenceCurrent?.[1][2]).toBeCloseTo(0.5, 6);
  });

});

describe("cube pose snapping", () => {
  const yaw = (deg: number): Matrix3 => quaternionMatrix(quaternionFromAxisAngle("y", deg));
  const near = (a: Matrix3, b: Matrix3) => rotationDistanceDeg(a, b);

  it("contains exactly the 24 legal cube orientations", () => {
    expect(CUBE_POSE_GROUP).toHaveLength(24);
  });

  it("snaps pure-yaw poses to the nearest quarter turn", () => {
    expect(near(snapToCubePose(yaw(0)), yaw(0))).toBeLessThan(1e-9);
    expect(near(snapToCubePose(yaw(20)), yaw(0))).toBeLessThan(1e-9);
    expect(near(snapToCubePose(yaw(50)), yaw(90))).toBeLessThan(1e-9);
    expect(near(snapToCubePose(yaw(180)), yaw(180))).toBeLessThan(1e-9);
    expect(near(snapToCubePose(yaw(-100)), yaw(-90))).toBeLessThan(1e-9);
  });

  it("stays within 45 degrees for near-upright poses and bounded for any pose", () => {
    for (let deg = 0; deg < 360; deg += 15) {
      for (const tilt of [0, 10, 20, 45, 60, 90]) {
        const pose = multiplyMatrix3(yaw(deg), quaternionMatrix(quaternionFromAxisAngle("x", tilt)));
        const distance = near(snapToCubePose(pose), pose);
        if (tilt <= 20) expect(distance, `yaw ${deg} tilt ${tilt}`).toBeLessThanOrEqual(45 + tilt + 1e-9);
        // The 24-group covering radius is ~54-63 degrees for arbitrary poses.
        expect(distance, `yaw ${deg} tilt ${tilt}`).toBeLessThanOrEqual(65);
      }
    }
  });
});
