import type { CubeQuaternion } from "$lib/protocols/gan/types";

export interface RelativeBodyRotation {
  axis: { x: number; y: number; z: number };
  angleDeg: number;
  dominantAxis: "x" | "y" | "z";
  direction: "positive" | "negative";
}

export function relativeProtocolRotation(
  start: CubeQuaternion | null,
  end: CubeQuaternion | null,
): RelativeBodyRotation | null {
  if (!start || !end) return null;
  const startNorm = Math.hypot(start.x, start.y, start.z, start.w);
  const endNorm = Math.hypot(end.x, end.y, end.z, end.w);
  if (startNorm < 1e-6 || endNorm < 1e-6) return null;
  const a = { x: start.x / startNorm, y: start.y / startNorm, z: start.z / startNorm, w: start.w / startNorm };
  const b = { x: end.x / endNorm, y: end.y / endNorm, z: end.z / endNorm, w: end.w / endNorm };
  const inverseA = { x: -a.x, y: -a.y, z: -a.z, w: a.w };
  // GAN V4 runtime SSOT uses current * inverse(reference). Keeping validation
  // in the same order makes its sensor-axis evidence directly comparable to
  // GAN_V4_SENSOR_AXES instead of learning a per-user compensation.
  let delta = {
    x: b.w * inverseA.x + b.x * inverseA.w + b.y * inverseA.z - b.z * inverseA.y,
    y: b.w * inverseA.y - b.x * inverseA.z + b.y * inverseA.w + b.z * inverseA.x,
    z: b.w * inverseA.z + b.x * inverseA.y - b.y * inverseA.x + b.z * inverseA.w,
    w: b.w * inverseA.w - b.x * inverseA.x - b.y * inverseA.y - b.z * inverseA.z,
  };
  if (delta.w < 0) delta = { x: -delta.x, y: -delta.y, z: -delta.z, w: -delta.w };
  const angleRad = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w)));
  const sinHalf = Math.sin(angleRad / 2);
  const axis = Math.abs(sinHalf) < 1e-6
    ? { x: 0, y: 0, z: 0 }
    : { x: delta.x / sinHalf, y: delta.y / sinHalf, z: delta.z / sinHalf };
  const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
  const dominantAxis = axes.sort((left, right) => Math.abs(axis[right]) - Math.abs(axis[left]))[0];
  return {
    axis,
    angleDeg: angleRad * 180 / Math.PI,
    dominantAxis,
    direction: axis[dominantAxis] >= 0 ? "positive" : "negative",
  };
}

export function axisDot(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function matchesAxisDirection(
  observedAxis: { x: number; y: number; z: number },
  expectedDirection: "positive" | "negative",
  positiveReference: { x: number; y: number; z: number },
  threshold = 0.8,
): boolean {
  const alignment = axisDot(observedAxis, positiveReference);
  return expectedDirection === "positive" ? alignment >= threshold : alignment <= -threshold;
}
