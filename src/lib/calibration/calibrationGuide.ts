import type { CubeColor, DynamicAxisCapture } from "./signalProfile";

const COLOR_VECTORS: Record<CubeColor, [number, number, number]> = {
  white: [0, 1, 0],
  yellow: [0, -1, 0],
  green: [0, 0, 1],
  blue: [0, 0, -1],
  red: [1, 0, 0],
  orange: [-1, 0, 0],
};

function colorForVector(vector: [number, number, number]): CubeColor {
  return (Object.entries(COLOR_VECTORS) as Array<[CubeColor, [number, number, number]]>)
    .find(([, candidate]) => candidate.every((value, index) => value === vector[index]))?.[0] ?? "red";
}

function cross(
  left: [number, number, number],
  right: [number, number, number],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export interface DynamicGuideModel {
  top: CubeColor;
  startFront: CubeColor;
  startRight: CubeColor;
  endFront: CubeColor;
  direction: NonNullable<DynamicAxisCapture["motionDirection"]>;
  angleDeg: 90 | 180;
  cssTurnDeg: number;
}

export function createDynamicGuideModel(input: {
  positiveFace: CubeColor;
  motionDirection: NonNullable<DynamicAxisCapture["motionDirection"]>;
  targetAngleDeg: 90 | 180;
}): DynamicGuideModel {
  const top = input.positiveFace;
  // Pick a deterministic, orthogonal face toward the user so the illustration
  // has an unambiguous starting grip for every physical axis.
  const startFront: CubeColor = top === "white" || top === "yellow" ? "green" : "white";
  const startRight = colorForVector(cross(COLOR_VECTORS[top], COLOR_VECTORS[startFront]));
  const endFront = input.targetAngleDeg === 180
    ? colorForVector(COLOR_VECTORS[startFront].map((value) => -value) as [number, number, number])
    : input.motionDirection === "clockwise"
      ? startRight
      : colorForVector(COLOR_VECTORS[startRight].map((value) => -value) as [number, number, number]);
  return {
    top,
    startFront,
    startRight,
    endFront,
    direction: input.motionDirection,
    angleDeg: input.targetAngleDeg,
    // CSS rotateY is positive in the right-hand direction. Seen from above,
    // a physical clockwise turn is therefore negative around the local top axis.
    cssTurnDeg: (input.motionDirection === "clockwise" ? -1 : 1) * input.targetAngleDeg,
  };
}

export function rightColor(top: CubeColor, front: CubeColor): CubeColor {
  return colorForVector(cross(COLOR_VECTORS[top], COLOR_VECTORS[front]));
}
