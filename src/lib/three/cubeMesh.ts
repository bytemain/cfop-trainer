import { Euler, Group, Mesh, MeshStandardMaterial, Quaternion } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { StickerColor } from "$lib/cube/cube";

export const CUBIE_SPACING = 1.01;

export interface BuiltCubieSticker {
  normal: readonly [number, number, number];
  mesh: Mesh;
}

export interface BuiltCubie {
  home: [number, number, number];
  group: Group;
  stickers: BuiltCubieSticker[];
}

const BODY_COLOR = 0x080a0a;

function quaternionForNormal(normal: readonly [number, number, number]): Quaternion {
  const [x, y, z] = normal;
  if (y === 1) return new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0, "XYZ"));
  if (y === -1) return new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0, "XYZ"));
  if (x === 1) return new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0, "XYZ"));
  if (x === -1) return new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, 0, "XYZ"));
  if (z === -1) return new Quaternion().setFromEuler(new Euler(0, Math.PI, 0, "XYZ"));
  return new Quaternion();
}

/**
 * Build the 27 cubies of a 3x3 cube. Each cubie is a Group positioned on the
 * logical grid, carrying a rounded body and one sticker per exposed face.
 * Sticker materials come from the caller-supplied factory so palettes stay
 * owner-specific; geometry and body material are shared across cubies.
 */
export function buildCubeCubies(
  stickerMaterial: (color: StickerColor) => MeshStandardMaterial,
  stickerColorAt: (
    home: readonly [number, number, number],
    normal: readonly [number, number, number],
  ) => StickerColor,
): BuiltCubie[] {
  const bodyGeometry = new RoundedBoxGeometry(0.99, 0.99, 0.99, 4, 0.085);
  const bodyMaterial = new MeshStandardMaterial({
    color: BODY_COLOR,
    roughness: 0.72,
    metalness: 0.04,
  });
  const stickerBox = new RoundedBoxGeometry(0.88, 0.88, 0.075, 3, 0.055);
  const cubies: BuiltCubie[] = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        const home: [number, number, number] = [x, y, z];
        const group = new Group();
        group.position.set(x * CUBIE_SPACING, y * CUBIE_SPACING, z * CUBIE_SPACING);
        group.add(new Mesh(bodyGeometry, bodyMaterial));
        const stickers: BuiltCubieSticker[] = [];
        home.forEach((value, axis) => {
          if (value === 0) return;
          const normal: [number, number, number] = [0, 0, 0];
          normal[axis] = value;
          const sticker = new Mesh(stickerBox, stickerMaterial(stickerColorAt(home, normal)));
          sticker.quaternion.copy(quaternionForNormal(normal));
          sticker.position.set(normal[0] * 0.53, normal[1] * 0.53, normal[2] * 0.53);
          group.add(sticker);
          stickers.push({ normal, mesh: sticker });
        });
        cubies.push({ home, group, stickers });
      }
    }
  }
  return cubies;
}
