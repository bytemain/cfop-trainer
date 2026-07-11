import { gyroModelMatrix, type GyroCalibration } from "$lib/cube/orientation";
import type { Face, StickerColor } from "$lib/cube/cube";
import type { CubeQuaternion } from "$lib/protocols/gan/types";

export interface RecognizedCubePose {
  topFace: Face;
  frontFace: Face;
  topColor: StickerColor;
  frontColor: StickerColor;
  topAlignment: number;
  frontAlignment: number;
  confident: boolean;
}

const FACE_NORMALS: Record<Face, [number, number, number]> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};

function transformVector(matrix: number[][], vector: [number, number, number]): [number, number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

export function recognizeCubePose(
  quaternion: CubeQuaternion | null,
  calibration: GyroCalibration,
  faceColors: Record<Face, StickerColor>,
): RecognizedCubePose | null {
  const matrix = gyroModelMatrix(quaternion, calibration);
  if (!matrix) return null;
  const transformed = (Object.entries(FACE_NORMALS) as Array<[Face, [number, number, number]]>)
    .map(([face, normal]) => ({ face, normal: transformVector(matrix, normal) }));
  const top = transformed.reduce((best, candidate) =>
    candidate.normal[1] > best.normal[1] ? candidate : best,
  );
  const front = transformed
    .filter((candidate) => candidate.face !== top.face)
    .reduce((best, candidate) => candidate.normal[2] > best.normal[2] ? candidate : best);
  const topAlignment = top.normal[1];
  const frontAlignment = front.normal[2];
  return {
    topFace: top.face,
    frontFace: front.face,
    topColor: faceColors[top.face],
    frontColor: faceColors[front.face],
    topAlignment,
    frontAlignment,
    confident: topAlignment >= 0.9 && frontAlignment >= 0.9,
  };
}
