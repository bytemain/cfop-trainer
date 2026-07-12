import { expectedCubePoseMatrix, type CubeColor, type DynamicAxisCapture } from "./signalProfile";
import { applyMatrix3, multiplyMatrix3, rotationDistanceDeg, transposeMatrix3 } from "$lib/cube/orientation";

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

export interface PoseGraphNode {
  top: CubeColor;
  front: CubeColor;
}

export interface PoseGraphEdgeGuide {
  start: PoseGraphNode;
  end: PoseGraphNode;
  physicalAxis: DynamicAxisCapture["physicalAxis"];
  positiveFace: CubeColor;
  motionDirection: NonNullable<DynamicAxisCapture["motionDirection"]>;
  targetAngleDeg: 90 | 180;
  title: string;
}

export const POSE_GRAPH_NODE_SEQUENCE: readonly PoseGraphNode[] = [
  { top: "white", front: "green" },
  { top: "white", front: "red" },
  { top: "white", front: "blue" },
  { top: "white", front: "orange" },
  { top: "red", front: "white" },
  { top: "red", front: "green" },
  { top: "red", front: "yellow" },
  { top: "red", front: "blue" },
  { top: "green", front: "red" },
  { top: "green", front: "white" },
  { top: "green", front: "orange" },
  { top: "green", front: "yellow" },
  { top: "yellow", front: "blue" },
  { top: "yellow", front: "red" },
  { top: "yellow", front: "green" },
  { top: "yellow", front: "orange" },
  { top: "orange", front: "white" },
  { top: "orange", front: "green" },
  { top: "orange", front: "yellow" },
  { top: "orange", front: "blue" },
  { top: "blue", front: "red" },
  { top: "blue", front: "white" },
  { top: "blue", front: "orange" },
  { top: "blue", front: "yellow" },
] as const;

function dominantBodyAxisForTransition(start: PoseGraphNode, end: PoseGraphNode): {
  physicalAxis: DynamicAxisCapture["physicalAxis"];
  positiveFace: CubeColor;
  motionDirection: NonNullable<DynamicAxisCapture["motionDirection"]>;
} {
  const startMatrix = expectedCubePoseMatrix(start.top, start.front);
  const endMatrix = expectedCubePoseMatrix(end.top, end.front);
  const worldDelta = multiplyMatrix3(endMatrix, transposeMatrix3(startMatrix));
  const worldAxis: [number, number, number] = [
    worldDelta[2][1] - worldDelta[1][2],
    worldDelta[0][2] - worldDelta[2][0],
    worldDelta[1][0] - worldDelta[0][1],
  ];
  const bodyAxis = applyMatrix3(transposeMatrix3(startMatrix), worldAxis);
  const dominant = bodyAxis.map(Math.abs).indexOf(Math.max(...bodyAxis.map(Math.abs)));
  const sign = bodyAxis[dominant] >= 0 ? 1 : -1;
  const physicalAxis = (["red-orange", "white-yellow", "blue-green"] as const)[dominant];
  const positiveFace = ([
    sign > 0 ? "red" : "orange",
    sign > 0 ? "white" : "yellow",
    sign > 0 ? "green" : "blue",
  ] as CubeColor[])[dominant];
  return {
    physicalAxis,
    positiveFace,
    motionDirection: sign > 0 ? "counterclockwise" : "clockwise",
  };
}

export function createContinuousPoseGraphEdges(): PoseGraphEdgeGuide[] {
  return POSE_GRAPH_NODE_SEQUENCE.map((start, index) => {
    const end = POSE_GRAPH_NODE_SEQUENCE[(index + 1) % POSE_GRAPH_NODE_SEQUENCE.length];
    const targetAngleDeg = Math.round(rotationDistanceDeg(
      expectedCubePoseMatrix(start.top, start.front),
      expectedCubePoseMatrix(end.top, end.front),
    )) as 90 | 180;
    return {
      start,
      end,
      ...dominantBodyAxisForTransition(start, end),
      targetAngleDeg,
      title: `${start.top}/${start.front} → ${end.top}/${end.front}`,
    };
  });
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
