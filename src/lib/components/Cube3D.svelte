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
  import {
    FACES,
    cloneCube,
    createSolvedCube,
    stickerGeometry,
    type CubeState,
    type StickerColor,
    type StickerPalette,
  } from "$lib/cube/cube";
  import { executeMoves } from "$lib/cube/algorithm";
  import {
    parseAlgorithmToken,
    pivotAngleForTurn,
    rotateVectorByTurn,
    turnIncludesHome,
  } from "$lib/cube/layerAnimation";
  import { buildCubeCubies, CUBIE_SPACING } from "$lib/three/cubeMesh";
  import { gyroModelMatrix, type GyroCalibration } from "$lib/cube/orientation";
  import type { CubeQuaternion } from "$lib/protocols/gan/types";

  let {
    cube,
    orientation = null,
    gyroCalibration,
    stickerPalette,
    interactive = true,
    moveSerial = 0,
    lastMove = null,
  }: {
    cube: CubeState;
    orientation?: CubeQuaternion | null;
    gyroCalibration: GyroCalibration;
    stickerPalette: StickerPalette;
    interactive?: boolean;
    moveSerial?: number;
    lastMove?: string | null;
  } = $props();

  let canvas: HTMLCanvasElement;
  let stage: HTMLDivElement;
  let renderer: WebGLRenderer | null = null;
  let camera: PerspectiveCamera | null = null;
  let viewGroup: Group | null = null;
  let poseGroup: Group | null = null;
  let cubieRoot: Group | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let animationFrame: number | null = null;
  let poseAnimationFrame: number | null = null;
  let lastPoseFrameAt = 0;
  let hasDisplayedPose = false;
  let dragging = $state(false);
  let dragLastX = 0;
  let dragLastY = 0;
  const viewQuaternion = new Quaternion();
  const targetPoseQuaternion = new Quaternion();
  const displayedPoseQuaternion = new Quaternion();
  const stickerMaterials = new Map<string, MeshStandardMaterial>();

  // ---------------------------------------------------------------------------
  // Layer-turn animation. The cube is built from 27 individual cubies so a move
  // can pivot one layer around its face axis instead of repainting stickers.
  // The facelet `cube` prop stays authoritative: moves animate, everything else
  // (snapshots, resync, color remaps) hard-syncs cubie transforms immediately.
  // ---------------------------------------------------------------------------

  interface CubieSticker {
    normal: readonly [number, number, number];
    mesh: Mesh;
    color: StickerColor | null;
  }

  interface Cubie {
    home: [number, number, number];
    group: Group;
    stickers: CubieSticker[];
  }

  const cubies: Cubie[] = [];
  const moveQueue: ReturnType<typeof parseAlgorithmToken>[] = [];
  let expectedCube: CubeState = createSolvedCube();
  let lastSerial = 0;
  let moveAnimating = false;
  let moveGeneration = 0;
  let activePivot: Group | null = null;

  // The 24 axis-aligned cube rotations. Used to snap cubie orientations back
  // onto the grid after an animation and to reconstruct cubie poses from a
  // facelet snapshot during hard sync.
  const CUBE_ROTATION_GROUP: Quaternion[] = (() => {
    const generators = [
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
    ];
    const members: Quaternion[] = [];
    const seen = new Set<string>();
    const pending: Quaternion[] = [new Quaternion()];
    while (pending.length > 0) {
      const candidate = pending.pop()!;
      const key = [candidate.x, candidate.y, candidate.z, candidate.w]
        .map((value) => value.toFixed(3))
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      members.push(candidate);
      for (const generator of generators) {
        pending.push(generator.clone().multiply(candidate));
      }
    }
    return members;
  })();

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

  function buildCubies(): void {
    if (!cubieRoot) return;
    const built = buildCubeCubies(materialFor, () => "white");
    for (const item of built) {
      cubieRoot.add(item.group);
      cubies.push({
        home: item.home,
        group: item.group,
        stickers: item.stickers.map((sticker) => ({ ...sticker, color: null })),
      });
    }
  }

  function sameAxisVector(
    left: readonly [number, number, number],
    right: readonly [number, number, number],
  ): boolean {
    return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
  }

  function rotateNormalByQuaternion(
    normal: readonly [number, number, number],
    rotation: Quaternion,
  ): [number, number, number] {
    const vector = new Vector3(normal[0], normal[1], normal[2]).applyQuaternion(rotation);
    return [Math.round(vector.x), Math.round(vector.y), Math.round(vector.z)];
  }

  function cubeEquals(left: CubeState, right: CubeState): boolean {
    return FACES.every((face) => left[face].every((color, index) => color === right[face][index]));
  }

  function isAnimatableMove(notation: string | null | undefined): boolean {
    return !!notation && parseAlgorithmToken(notation) !== null;
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // Rebuild every cubie transform and sticker color from a facelet state.
  // Used for the initial render and for any update that is not a single
  // animatable layer move (BLE snapshots, desync resync, palette remaps).
  function hardSync(state: CubeState): void {
    moveGeneration += 1;
    moveQueue.length = 0;
    moveAnimating = false;
    dissolvePivot();
    if (cubies.length > 0) {
      const worldStickers = FACES.flatMap((face) =>
        state[face].map((color, index) => {
          const geometry = stickerGeometry(face, index);
          return { position: geometry.position, normal: geometry.normal, color };
        }),
      );
      for (const cubie of cubies) {
        const placed = worldStickers.filter((sticker) =>
          sameAxisVector(sticker.position, cubie.home),
        );
        const localNormals = cubie.stickers.map((sticker) => sticker.normal);
        let matched: Quaternion | null = null;
        if (localNormals.length === 0) {
          matched = new Quaternion();
        } else {
          for (const candidate of CUBE_ROTATION_GROUP) {
            const fits = localNormals.every((local) =>
              placed.some((sticker) =>
                sameAxisVector(rotateNormalByQuaternion(local, candidate), sticker.normal),
              ),
            );
            if (fits) {
              matched = candidate;
              break;
            }
          }
        }
        cubie.group.position.set(
          cubie.home[0] * CUBIE_SPACING,
          cubie.home[1] * CUBIE_SPACING,
          cubie.home[2] * CUBIE_SPACING,
        );
        cubie.group.quaternion.copy(matched ?? new Quaternion());
        for (const sticker of cubie.stickers) {
          const worldNormal = rotateNormalByQuaternion(sticker.normal, cubie.group.quaternion);
          const source = placed.find((candidate) => sameAxisVector(candidate.normal, worldNormal));
          if (!source) continue;
          sticker.color = source.color;
          sticker.mesh.material = materialFor(source.color);
        }
      }
    }
    expectedCube = cloneCube(state);
    requestRender();
  }

  function dissolvePivot(): void {
    if (!activePivot || !cubieRoot) {
      activePivot = null;
      return;
    }
    for (const child of [...activePivot.children]) cubieRoot.attach(child);
    cubieRoot.remove(activePivot);
    activePivot = null;
  }

  function enqueueMove(notation: string): void {
    const turn = parseAlgorithmToken(notation);
    if (!turn) return;
    expectedCube = executeMoves(expectedCube, [notation]);
    if (prefersReducedMotion()) {
      hardSync(expectedCube);
      return;
    }
    moveQueue.push(turn);
    // A burst far beyond playback speed means we are seconds behind; snap to
    // the authoritative state instead of replaying stale choreography.
    if (moveQueue.length > 32) {
      hardSync(expectedCube);
      return;
    }
    pumpMoveQueue();
  }

  function nearestGroupQuaternion(rotation: Quaternion): Quaternion {
    let best = CUBE_ROTATION_GROUP[0];
    let bestAngle = Infinity;
    for (const candidate of CUBE_ROTATION_GROUP) {
      const angle = rotation.angleTo(candidate);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = candidate;
      }
    }
    return best;
  }

  // Queued moves play faster so live device bursts (~11 Hz on GAN16) catch up
  // without growing the backlog indefinitely.
  function moveDuration(amount: 1 | -1 | 2): number {
    const base = Math.max(80, 210 - moveQueue.length * 26);
    return base * (amount === 2 ? 1.35 : 1);
  }

  function pumpMoveQueue(): void {
    if (moveAnimating || moveQueue.length === 0 || !cubieRoot || !renderer || !camera) return;
    const turn = moveQueue.shift()!;
    const layer = cubies.filter((cubie) => turnIncludesHome(cubie.home, turn));
    moveAnimating = true;
    const generation = moveGeneration;
    const pivot = new Group();
    cubieRoot.add(pivot);
    activePivot = pivot;
    cubieRoot.updateMatrixWorld(true);
    for (const cubie of layer) pivot.attach(cubie.group);
    const normal = turn.normal;
    const axisVector = new Vector3(normal[0], normal[1], normal[2]);
    const targetAngle = pivotAngleForTurn(turn);
    const duration = moveDuration(turn.amount);
    const startedAt = performance.now();
    const activeRenderer = renderer;
    const activeCamera = camera;

    const step = (now: number) => {
      if (generation !== moveGeneration || !cubieRoot) {
        moveAnimating = false;
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      pivot.quaternion.setFromAxisAngle(axisVector, targetAngle * eased);
      activeRenderer.render(rendererScene, activeCamera);
      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }
      // Bake the finished turn into each cubie and snap back onto the grid so
      // float drift never accumulates across long solve sessions.
      pivot.quaternion.setFromAxisAngle(axisVector, targetAngle);
      pivot.updateMatrixWorld(true);
      for (const cubie of layer) {
        cubieRoot.attach(cubie.group);
        cubie.home = rotateVectorByTurn(cubie.home, turn);
        cubie.group.position.set(
          cubie.home[0] * CUBIE_SPACING,
          cubie.home[1] * CUBIE_SPACING,
          cubie.home[2] * CUBIE_SPACING,
        );
        cubie.group.quaternion.copy(nearestGroupQuaternion(cubie.group.quaternion));
      }
      cubieRoot.remove(pivot);
      activePivot = null;
      moveAnimating = false;
      pumpMoveQueue();
    };
    requestAnimationFrame(step);
  }

  function updatePose(): void {
    if (!poseGroup) return;
    const matrix = gyroModelMatrix(orientation, gyroCalibration);
    if (!matrix) {
      targetPoseQuaternion.identity();
    } else {
      const rotation = new Matrix4().set(
        matrix[0][0], matrix[0][1], matrix[0][2], 0,
        matrix[1][0], matrix[1][1], matrix[1][2], 0,
        matrix[2][0], matrix[2][1], matrix[2][2], 0,
        0, 0, 0, 1,
      );
      targetPoseQuaternion.setFromRotationMatrix(rotation).normalize();
    }
    const offset = new Quaternion().setFromEuler(new Euler(
      gyroCalibration.offsetX * Math.PI / 180,
      gyroCalibration.offsetY * Math.PI / 180,
      gyroCalibration.offsetZ * Math.PI / 180,
      "XYZ",
    ));
    targetPoseQuaternion.multiply(offset).normalize();
    if (!hasDisplayedPose) {
      hasDisplayedPose = true;
      displayedPoseQuaternion.copy(targetPoseQuaternion);
      poseGroup.quaternion.copy(displayedPoseQuaternion);
      requestRender();
      return;
    }
    startPoseSmoothing();
  }

  function startPoseSmoothing(): void {
    if (poseAnimationFrame !== null) return;
    lastPoseFrameAt = performance.now();
    const animate = (now: number) => {
      if (!poseGroup || !renderer || !camera) {
        poseAnimationFrame = null;
        return;
      }
      const elapsed = Math.min(64, Math.max(1, now - lastPoseFrameAt));
      lastPoseFrameAt = now;
      // GAN16 is about 11.4 Hz. A short exponential SLERP fills visual frames
      // without inventing protocol samples or extrapolating through long gaps.
      const factor = 1 - Math.exp(-elapsed / 45);
      displayedPoseQuaternion.slerp(targetPoseQuaternion, factor).normalize();
      poseGroup.quaternion.copy(displayedPoseQuaternion);
      renderer.render(rendererScene, camera);
      if (displayedPoseQuaternion.angleTo(targetPoseQuaternion) > 0.0005) {
        poseAnimationFrame = requestAnimationFrame(animate);
      } else {
        displayedPoseQuaternion.copy(targetPoseQuaternion);
        poseGroup.quaternion.copy(displayedPoseQuaternion);
        renderer.render(rendererScene, camera);
        poseAnimationFrame = null;
      }
    };
    poseAnimationFrame = requestAnimationFrame(animate);
  }

  function resetView(): void {
    viewQuaternion.setFromEuler(new Euler(24 * Math.PI / 180, 34 * Math.PI / 180, 0, "XYZ"));
    viewGroup?.quaternion.copy(viewQuaternion);
    syncViewAttribute();
    requestRender();
  }

  function syncViewMode(): void {
    if (interactive) {
      resetView();
      return;
    }
    // In physical-follow mode the camera frame must be neutral. The poseGroup
    // already contains the complete GAN-derived cube pose; retaining the
    // manual browser's isometric 24°/34° view would visually tilt every valid
    // physical orientation a second time.
    viewQuaternion.identity();
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
    if (!interactive) return;
    dragging = true;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (!interactive || !dragging) return;
    const deltaX = event.clientX - dragLastX;
    const deltaY = event.clientY - dragLastY;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    if (deltaX !== 0) rotateView("y", deltaX * 0.45);
    if (deltaY !== 0) rotateView("x", deltaY * 0.45);
    event.preventDefault();
  }

  function stopDrag(event: PointerEvent): void {
    if (!interactive) return;
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function rotateWithKeyboard(event: KeyboardEvent): void {
    if (!interactive) return;
    const step = event.shiftKey ? 30 : 12;
    if (event.key === "ArrowLeft") rotateView("y", -step);
    else if (event.key === "ArrowRight") rotateView("y", step);
    else if (event.key === "ArrowUp") rotateView("x", step);
    else if (event.key === "ArrowDown") rotateView("x", -step);
    else if (event.key === "Home") resetView();
    else return;
    event.preventDefault();
  }

  // One sync path for every way the facelet state can change:
  //  - serial advanced by exactly one with a layer move -> animate that move;
  //  - serial reset/jumped, or the state diverges from what the animation
  //    queue predicts -> hard-sync from the authoritative facelet state.
  $effect(() => {
    const serial = moveSerial;
    const state = cube;
    const move = lastMove;
    const previousSerial = lastSerial;
    lastSerial = serial;
    if (!cubieRoot) return;
    if (serial === previousSerial) {
      if (!cubeEquals(state, expectedCube)) hardSync(state);
      return;
    }
    if (serial === previousSerial + 1 && isAnimatableMove(move)) {
      enqueueMove(move!);
      if (!cubeEquals(state, expectedCube)) hardSync(state);
      return;
    }
    hardSync(state);
  });

  $effect(() => {
    stickerPalette;
    if (cubies.length === 0) return;
    for (const cubie of cubies) {
      for (const sticker of cubie.stickers) {
        if (sticker.color) sticker.mesh.material = materialFor(sticker.color);
      }
    }
    requestRender();
  });

  $effect(() => {
    orientation;
    gyroCalibration;
    updatePose();
  });

  $effect(() => {
    interactive;
    syncViewMode();
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
    cubieRoot = new Group();
    poseGroup.add(cubieRoot);
    viewGroup.add(poseGroup);
    rendererScene.add(viewGroup);
    buildCubies();
    hardSync(cube);

    const shadow = new Mesh(
      new PlaneGeometry(5.4, 2.2),
      new MeshStandardMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -2.12;
    rendererScene.add(shadow);

    syncViewMode();
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
      moveGeneration += 1;
      moveQueue.length = 0;
      moveAnimating = false;
      activePivot = null;
      cubies.length = 0;
      resizeObserver?.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (poseAnimationFrame !== null) cancelAnimationFrame(poseAnimationFrame);
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
      cubieRoot = null;
    };
  });
</script>

<div class="cube-3d-wrap">
  <div
    bind:this={stage}
    class:dragging
    class:interactive
    class="cube-stage"
  >
    <canvas
      bind:this={canvas}
      role={interactive ? "button" : "img"}
      tabindex={interactive ? 0 : -1}
      aria-label={interactive
        ? "当前魔方 3D 视图（WebGL）。可向任意方向连续拖动翻转，双击或按 Home 恢复默认视角。"
        : "当前魔方 3D 实时姿态（WebGL）。真机陀螺仪跟随时已禁用手动拖动。"}
      onpointerdown={startDrag}
      onpointermove={moveDrag}
      onpointerup={stopDrag}
      onpointercancel={stopDrag}
      onkeydown={rotateWithKeyboard}
      ondblclick={() => interactive && resetView()}
    ></canvas>
  </div>
  <p>{interactive ? "GPU WebGL 全向视图 · 拖动观察 · 双击 / Home 复位" : "GPU WebGL 实时姿态 · 正对相机 · 手动拖动已禁用"}</p>
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
    cursor: default;
    touch-action: auto;
    user-select: none;
  }

  .cube-stage.interactive { cursor: grab; touch-action: none; }
  .cube-stage.interactive.dragging { cursor: grabbing; }
  canvas { display: block; width: 100%; height: 100%; border-radius: inherit; outline: none; }
  canvas:focus-visible { box-shadow: inset 0 0 0 2px rgb(135 232 188 / 0.8); }
  p { margin: 0; color: var(--color-text-muted); font-size: 0.68rem; }

  @media (max-width: 599px) {
    .cube-3d-wrap { min-height: 278px; padding: 0 6px 12px; }
    .cube-stage { height: 268px; }
  }
</style>
