<script lang="ts">
  import { onMount } from "svelte";
  import {
    ACESFilmicToneMapping,
    AmbientLight,
    CanvasTexture,
    Color,
    DirectionalLight,
    Euler,
    Group,
    LinearFilter,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    Scene,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer,
  } from "three";
  import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
  import {
    FACES,
    type CubeState,
    type Face,
    type StickerColor,
    type StickerPalette,
  } from "$lib/cube/cube";
  import { gyroModelMatrix, type GyroCalibration } from "$lib/cube/orientation";
  import type { CubeQuaternion } from "$lib/protocols/gan/types";

  let {
    cube,
    orientation = null,
    gyroCalibration,
    stickerPalette,
  }: {
    cube: CubeState;
    orientation?: CubeQuaternion | null;
    gyroCalibration: GyroCalibration;
    stickerPalette: StickerPalette;
  } = $props();

  let canvas: HTMLCanvasElement;
  let stage: HTMLDivElement;
  let renderer: WebGLRenderer | null = null;
  let camera: PerspectiveCamera | null = null;
  let viewGroup: Group | null = null;
  let poseGroup: Group | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let animationFrame: number | null = null;
  let stickerMeshes: Record<Face, Mesh[]> | null = null;
  let dragging = $state(false);
  let dragLastX = 0;
  let dragLastY = 0;
  const viewQuaternion = new Quaternion();
  const stickerMaterials = new Map<string, MeshStandardMaterial>();

  const faceRotations: Record<Face, [number, number, number]> = {
    F: [0, 0, 0],
    B: [0, Math.PI, 0],
    R: [0, Math.PI / 2, 0],
    L: [0, -Math.PI / 2, 0],
    U: [-Math.PI / 2, 0, 0],
    D: [Math.PI / 2, 0, 0],
  };

  function requestRender(): void {
    if (animationFrame !== null) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      renderer?.render(rendererScene, camera!);
    });
  }

  const rendererScene = new Scene();

  function materialFor(color: StickerColor): MeshStandardMaterial {
    const value = stickerPalette[color];
    const key = `${color}:${value}`;
    const existing = stickerMaterials.get(key);
    if (existing) return existing;
    const material = new MeshStandardMaterial({
      color: new Color(value),
      roughness: 0.38,
      metalness: 0.02,
    });
    stickerMaterials.set(key, material);
    return material;
  }

  function makeShadowTexture(): CanvasTexture {
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const context = shadowCanvas.getContext("2d")!;
    const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 118);
    gradient.addColorStop(0, "rgba(0,0,0,0.42)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.18)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const texture = new CanvasTexture(shadowCanvas);
    texture.minFilter = LinearFilter;
    return texture;
  }

  function buildCube(): void {
    if (!poseGroup) return;
    const body = new Mesh(
      new RoundedBoxGeometry(3.08, 3.08, 3.08, 5, 0.12),
      new MeshStandardMaterial({ color: 0x080a0a, roughness: 0.72, metalness: 0.04 }),
    );
    poseGroup.add(body);

    const geometry = new RoundedBoxGeometry(0.88, 0.88, 0.075, 3, 0.055);
    const nextMeshes: Record<Face, Mesh[]> = { U: [], R: [], F: [], D: [], L: [], B: [] };
    for (const face of FACES) {
      const faceGroup = new Group();
      faceGroup.rotation.set(...faceRotations[face]);
      for (let index = 0; index < 9; index += 1) {
        const row = Math.floor(index / 3);
        const column = index % 3;
        const sticker = new Mesh(geometry, materialFor(cube[face][index]));
        sticker.position.set((column - 1) * 1.01, (1 - row) * 1.01, 1.565);
        faceGroup.add(sticker);
        nextMeshes[face].push(sticker);
      }
      poseGroup.add(faceGroup);
    }
    stickerMeshes = nextMeshes;
  }

  function updateStickerColors(): void {
    if (!stickerMeshes) return;
    for (const face of FACES) {
      cube[face].forEach((color, index) => {
        stickerMeshes![face][index].material = materialFor(color);
      });
    }
    requestRender();
  }

  function updatePose(): void {
    if (!poseGroup) return;
    const matrix = gyroModelMatrix(orientation, gyroCalibration);
    if (!matrix) {
      poseGroup.quaternion.identity();
    } else {
      const rotation = new Matrix4().set(
        matrix[0][0], matrix[0][1], matrix[0][2], 0,
        matrix[1][0], matrix[1][1], matrix[1][2], 0,
        matrix[2][0], matrix[2][1], matrix[2][2], 0,
        0, 0, 0, 1,
      );
      poseGroup.quaternion.setFromRotationMatrix(rotation).normalize();
    }
    poseGroup.rotation.x += gyroCalibration.offsetX * Math.PI / 180;
    poseGroup.rotation.y += gyroCalibration.offsetY * Math.PI / 180;
    poseGroup.rotation.z += gyroCalibration.offsetZ * Math.PI / 180;
    requestRender();
  }

  function resetView(): void {
    viewQuaternion.setFromEuler(new Euler(24 * Math.PI / 180, 34 * Math.PI / 180, 0, "XYZ"));
    viewGroup?.quaternion.copy(viewQuaternion);
    syncViewAttribute();
    requestRender();
  }

  function syncViewAttribute(): void {
    canvas?.setAttribute(
      "data-view-quaternion",
      [viewQuaternion.x, viewQuaternion.y, viewQuaternion.z, viewQuaternion.w]
        .map((value) => value.toFixed(7))
        .join(","),
    );
  }

  function rotateView(axis: "x" | "y", degrees: number): void {
    const direction = axis === "x" ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const delta = new Quaternion().setFromAxisAngle(direction, degrees * Math.PI / 180);
    viewQuaternion.premultiply(delta).normalize();
    viewGroup?.quaternion.copy(viewQuaternion);
    syncViewAttribute();
    requestRender();
  }

  function startDrag(event: PointerEvent): void {
    dragging = true;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (!dragging) return;
    const deltaX = event.clientX - dragLastX;
    const deltaY = event.clientY - dragLastY;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    if (deltaX !== 0) rotateView("y", deltaX * 0.45);
    if (deltaY !== 0) rotateView("x", deltaY * 0.45);
    event.preventDefault();
  }

  function stopDrag(event: PointerEvent): void {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function rotateWithKeyboard(event: KeyboardEvent): void {
    const step = event.shiftKey ? 30 : 12;
    if (event.key === "ArrowLeft") rotateView("y", -step);
    else if (event.key === "ArrowRight") rotateView("y", step);
    else if (event.key === "ArrowUp") rotateView("x", step);
    else if (event.key === "ArrowDown") rotateView("x", -step);
    else if (event.key === "Home") resetView();
    else return;
    event.preventDefault();
  }

  $effect(() => {
    cube;
    stickerPalette;
    updateStickerColors();
  });

  $effect(() => {
    orientation;
    gyroCalibration;
    updatePose();
  });

  onMount(() => {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    camera = new PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.2, 10.8);
    camera.lookAt(0, 0, 0);
    rendererScene.add(new AmbientLight(0xffffff, 1.75));
    const keyLight = new DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(4, 7, 8);
    rendererScene.add(keyLight);
    const rimLight = new DirectionalLight(0x87e8bc, 1.4);
    rimLight.position.set(-6, 1, -4);
    rendererScene.add(rimLight);

    viewGroup = new Group();
    poseGroup = new Group();
    viewGroup.add(poseGroup);
    rendererScene.add(viewGroup);
    buildCube();

    const shadow = new Mesh(
      new PlaneGeometry(5.4, 2.2),
      new MeshStandardMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -2.12;
    rendererScene.add(shadow);

    resetView();
    updateStickerColors();
    updatePose();
    resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.max(1, entry.contentRect.width);
      const height = Math.max(1, entry.contentRect.height);
      renderer!.setSize(width, height, false);
      camera!.aspect = width / height;
      camera!.updateProjectionMatrix();
      requestRender();
    });
    resizeObserver.observe(stage);

    return () => {
      resizeObserver?.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      rendererScene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      stickerMaterials.clear();
      renderer?.dispose();
      renderer = null;
      camera = null;
      viewGroup = null;
      poseGroup = null;
      stickerMeshes = null;
    };
  });
</script>

<div class="cube-3d-wrap">
  <div
    bind:this={stage}
    class:dragging
    class="cube-stage"
  >
    <canvas
      bind:this={canvas}
      role="button"
      tabindex="0"
      aria-label="当前魔方 3D 视图（WebGL）。可向任意方向连续拖动翻转，双击或按 Home 恢复默认视角。"
      onpointerdown={startDrag}
      onpointermove={moveDrag}
      onpointerup={stopDrag}
      onpointercancel={stopDrag}
      onkeydown={rotateWithKeyboard}
      ondblclick={resetView}
    ></canvas>
  </div>
  <p>GPU WebGL 全向视图 · 拖动观察 · 双击 / Home 复位</p>
</div>

<style>
  .cube-3d-wrap {
    display: grid;
    min-height: 340px;
    place-items: center;
    align-content: center;
    gap: 8px;
    padding: 10px 18px 18px;
  }

  .cube-stage {
    width: min(100%, 520px);
    height: 320px;
    border-radius: 22px;
    background: radial-gradient(circle at 50% 44%, rgb(135 232 188 / 0.07), transparent 55%);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .cube-stage.dragging { cursor: grabbing; }
  canvas { display: block; width: 100%; height: 100%; border-radius: inherit; outline: none; }
  canvas:focus-visible { box-shadow: inset 0 0 0 2px rgb(135 232 188 / 0.8); }
  p { margin: 0; color: var(--color-text-muted); font-size: 0.68rem; }

  @media (max-width: 599px) {
    .cube-3d-wrap { min-height: 278px; padding: 0 6px 12px; }
    .cube-stage { height: 268px; }
  }
</style>
