import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import {
  FACES,
  stickerGeometry,
  type CubeState,
  type Face,
  type StickerColor,
  type StickerPalette,
} from "$lib/cube/cube";
import { buildCubeCubies } from "$lib/three/cubeMesh";

/**
 * Isometric 3D thumbnails for case cards. One shared offscreen WebGL context
 * renders every case once per palette; results are cached as data URLs so
 * the card list never holds live GL contexts (browsers cap those around 16).
 */

const RENDER_SIZE = 168;

const FACELET_AT = new Map<string, { face: Face; index: number }>();
for (const face of FACES) {
  for (let index = 0; index < 9; index += 1) {
    const { position, normal } = stickerGeometry(face, index);
    FACELET_AT.set(`${position.join(",")}|${normal.join(",")}`, { face, index });
  }
}

let renderer: WebGLRenderer | null = null;
let renderCanvas: HTMLCanvasElement | null = null;
const cache = new Map<string, string>();

function ensureRenderer(): { renderer: WebGLRenderer; canvas: HTMLCanvasElement } {
  if (renderer && renderCanvas) return { renderer, canvas: renderCanvas };
  renderCanvas = document.createElement("canvas");
  renderCanvas.width = RENDER_SIZE;
  renderCanvas.height = RENDER_SIZE;
  renderer = new WebGLRenderer({
    canvas: renderCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(1);
  renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
  return { renderer, canvas: renderCanvas };
}

function colorAtPosition(
  cube: CubeState,
  home: readonly [number, number, number],
  normal: readonly [number, number, number],
): StickerColor {
  const entry = FACELET_AT.get(`${home.join(",")}|${normal.join(",")}`);
  return entry ? cube[entry.face][entry.index] : "white";
}

export function caseThumbnailDataUrl(
  caseId: string,
  cube: CubeState,
  palette: StickerPalette,
): string {
  if (typeof document === "undefined") return "";
  const cacheKey = `${caseId}:${JSON.stringify(palette)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { renderer: gl, canvas } = ensureRenderer();
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.8));
  const keyLight = new DirectionalLight(0xffffff, 3.0);
  keyLight.position.set(4, 7, 8);
  scene.add(keyLight);
  const rimLight = new DirectionalLight(0x87e8bc, 1.2);
  rimLight.position.set(-6, 1, -4);
  scene.add(rimLight);

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(5.6, 4.9, 6.8);
  camera.lookAt(0, -0.15, 0);

  const materials = new Map<string, MeshStandardMaterial>();
  const materialFor = (color: StickerColor): MeshStandardMaterial => {
    const key = `${color}:${palette[color]}`;
    const existing = materials.get(key);
    if (existing) return existing;
    const material = new MeshStandardMaterial({ color: palette[color], roughness: 0.38, metalness: 0.02 });
    materials.set(key, material);
    return material;
  };

  const root = new Group();
  for (const cubie of buildCubeCubies(materialFor, (home, normal) => colorAtPosition(cube, home, normal))) {
    root.add(cubie.group);
  }
  scene.add(root);

  gl.render(scene, camera);
  const url = canvas.toDataURL("image/png");

  scene.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach((material) => material.dispose());
    }
  });
  materials.clear();

  cache.set(cacheKey, url);
  return url;
}
