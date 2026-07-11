import {
  gyroModelMatrix,
  normalizeQuaternion,
  quaternionMatrix,
  type DeviceCalibration,
  type Matrix3,
  type SessionAnchor,
  type ViewPreference,
  composeGyroCalibration,
} from "$lib/cube/orientation";
import type { CubeQuaternion } from "$lib/protocols/gan/types";

export type PoseHealthStatus =
  | "disabled"
  | "initializing"
  | "healthy"
  | "stale"
  | "reanchored"
  | "discontinuity"
  | "invalid";

export interface PoseHealth {
  status: PoseHealthStatus;
  message: string;
  lastAcceptedAt: number | null;
  rejectedFrames: number;
  reanchorCount: number;
  lastStepDeg: number | null;
}

export interface PoseObservation {
  accepted: boolean;
  quaternion: CubeQuaternion | null;
  anchor: SessionAnchor | null;
  health: PoseHealth;
}

const IDENTITY: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function angularDistanceDeg(left: CubeQuaternion, right: CubeQuaternion): number {
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot) * 180 / Math.PI;
}

function alignedTo(reference: CubeQuaternion, value: CubeQuaternion): CubeQuaternion {
  const current = normalizeQuaternion(value);
  const dot = reference.x * current.x + reference.y * current.y + reference.z * current.z + reference.w * current.w;
  return dot < 0
    ? { x: -current.x, y: -current.y, z: -current.z, w: -current.w }
    : current;
}

export class PoseSession {
  private anchor: SessionAnchor | null = null;
  private lastAccepted: CubeQuaternion | null = null;
  private lastAcceptedPose: Matrix3 = IDENTITY;
  private health: PoseHealth = {
    status: "initializing",
    message: "等待第一帧姿态",
    lastAcceptedAt: null,
    rejectedFrames: 0,
    reanchorCount: 0,
    lastStepDeg: null,
  };

  constructor(
    private device: DeviceCalibration,
    private view: ViewPreference,
  ) {}

  configure(device: DeviceCalibration, view: ViewPreference): void {
    this.device = device;
    this.view = view;
    if (!device.enabled) this.health = { ...this.health, status: "disabled", message: "陀螺仪跟随已关闭" };
  }

  bootstrap(sensorReference: CubeQuaternion, at = Date.now()): void {
    this.anchor = {
      sensorReference: normalizeQuaternion(sensorReference),
      cubeReference: IDENTITY,
      establishedAt: at,
      reason: "calibration",
    };
  }

  manuallyAnchor(current: CubeQuaternion, at = Date.now()): void {
    this.anchor = {
      sensorReference: normalizeQuaternion(current),
      cubeReference: IDENTITY,
      establishedAt: at,
      reason: "manual",
    };
    this.lastAccepted = null;
    this.health = { ...this.health, status: "initializing", message: "已建立新的会话基准" };
  }

  observe(value: CubeQuaternion, at: number): PoseObservation {
    if (!this.device.enabled) return this.result(false, null, "disabled", "陀螺仪跟随已关闭");
    const norm = Math.hypot(value.x, value.y, value.z, value.w);
    if (!Number.isFinite(norm) || norm < 0.65 || norm > 1.35) {
      this.health.rejectedFrames += 1;
      return this.result(false, null, "invalid", `四元数长度异常：${norm.toFixed(3)}`);
    }

    const current = this.lastAccepted ? alignedTo(this.lastAccepted, value) : normalizeQuaternion(value);
    if (!this.anchor) {
      this.anchor = {
        sensorReference: current,
        cubeReference: IDENTITY,
        establishedAt: at,
        reason: "session-start",
      };
    }

    const gapMs = this.health.lastAcceptedAt === null ? 0 : at - this.health.lastAcceptedAt;
    const stepDeg = this.lastAccepted ? angularDistanceDeg(this.lastAccepted, current) : 0;
    this.health.lastStepDeg = stepDeg;

    // A very large single step at normal notification cadence is not a
    // plausible GAN16 body motion. Reject it instead of poisoning WebGL state.
    if (this.lastAccepted && gapMs > 0 && gapMs <= 650 && stepDeg > 105) {
      this.health.rejectedFrames += 1;
      return this.result(false, null, "discontinuity", `拒绝 ${stepDeg.toFixed(1)}° 的瞬时姿态跳变`);
    }

    if (this.lastAccepted && gapMs > 2_500) {
      if (stepDeg > 105) {
        // The cube may have slept and restarted its sensor frame. Preserve the
        // last accepted canonical pose while rebasing the new sensor session.
        this.anchor = {
          sensorReference: current,
          cubeReference: this.lastAcceptedPose,
          establishedAt: at,
          reason: "sensor-reset",
        };
        this.health.reanchorCount += 1;
        this.lastAccepted = current;
        this.health.lastAcceptedAt = at;
        return this.result(true, current, "reanchored", "长时间中断后检测到传感器基准变化，已保持画面并重建会话锚点");
      }
      this.health.status = "stale";
      this.health.message = "长时间中断后已验证姿态连续性";
    }

    this.lastAccepted = current;
    this.health.lastAcceptedAt = at;
    const effective = composeGyroCalibration(this.device, this.anchor, this.view);
    this.lastAcceptedPose = gyroModelMatrix(current, effective) ?? this.lastAcceptedPose;
    return this.result(true, current, "healthy", "姿态数据连续");
  }

  currentAnchor(): SessionAnchor | null {
    return this.anchor;
  }

  currentHealth(): PoseHealth {
    return { ...this.health };
  }

  resetPhysicalSession(): void {
    this.anchor = null;
    this.lastAccepted = null;
    this.lastAcceptedPose = IDENTITY;
    this.health = {
      status: this.device.enabled ? "initializing" : "disabled",
      message: this.device.enabled ? "等待第一帧姿态" : "陀螺仪跟随已关闭",
      lastAcceptedAt: null,
      rejectedFrames: 0,
      reanchorCount: 0,
      lastStepDeg: null,
    };
  }

  private result(
    accepted: boolean,
    quaternion: CubeQuaternion | null,
    status: PoseHealthStatus,
    message: string,
  ): PoseObservation {
    this.health = { ...this.health, status, message };
    return { accepted, quaternion, anchor: this.anchor, health: { ...this.health } };
  }
}

export function quaternionAsMatrix(value: CubeQuaternion): Matrix3 {
  return quaternionMatrix(value);
}
