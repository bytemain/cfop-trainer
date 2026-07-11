# Cube pose SSOT

This document is the single source of truth for whole-cube orientation. Any
protocol adapter, calibration flow, renderer, debug panel, or test that needs
an orientation must use these definitions. Local axis swaps, quaternion
inversions, and renderer-specific corrections are forbidden outside their
named boundary functions.

## 1. What a pose is

A pose is an **active rigid rotation** that maps a vector fixed in the cube
body into the canonical cube world:

```text
v_world = R_cube_pose · v_cube_body
```

`R_cube_pose` is a proper 3×3 rotation matrix:

```text
RᵀR = I
det(R) = +1
```

It contains no translation, scale, reflection, camera angle, drag offset, CSS
axis correction, or sticker-state information.

## 2. Canonical cube frame

The domain uses one right-handed frame:

```text
+X = red center direction     (-X = orange)
+Y = white center direction   (-Y = yellow)
+Z = green center direction   (-Z = blue)
```

The canonical identity grip is therefore:

```text
white up · green front · red right
```

Sticker state and whole-cube pose are independent. Turning `R` changes the
sticker state; rotating the entire cube changes `R_cube_pose`.

## 3. Sensor frame

GAN protocol parsing produces a normalized sensor quaternion in `(x,y,z,w)`
storage order. The parser may reorder packet fields, but it must not apply UI
or CSS conventions.

The sensor quaternion alone is not a `CubePose`. Calibration owns exactly two
unknowns:

1. `relativeOrder`, one of:

   ```text
   current-reference-inverse: Rcurrent · Rreferenceᵀ
   reference-current-inverse: Rreference · Rcurrentᵀ
   ```

2. `bodyToModel`, a proper signed-axis rotation from the sensor delta frame to
   the canonical cube frame.

The normalized domain pose is:

```text
Rdelta = relativeOrder(reference, current)
Rcube  = bodyToModel · Rdelta · bodyToModelᵀ
```

The multiplication order is data, not an implementation detail. ROS tf2 also
defines a relative rotation that takes `q1` to `q2` as
`q_relative = q2 × inverse(q1)` and explicitly warns that order matters.

## 4. Calibration solver

The solver must jointly choose `relativeOrder` and `bodyToModel`. It may not
derive one in the protocol parser and silently compensate for it in the UI.

For the current GAN calibration flow it evaluates:

```text
2 relative orders × 24 proper signed-axis rotations
```

Each candidate is scored against:

- all captured static `top/front` poses as complete 3D rotations;
- all three controlled whole-cube rotations as independent direction checks.

The three dynamic axes are validation evidence; they are not by themselves a
complete pose model. A calibration persists its mean/max angular residual so a
poor capture cannot masquerade as an exact mapping.

### Calibration protocol V2

The capture UI must provide enough independent excitation to distinguish a
rigid pose model from a mapping that only happens to work near one grip:

1. **24 tabletop static poses**: every valid combination of six top colors and
   four orthogonal front colors. Each step owns a fresh rolling window; samples
   from the previous pose may not leak into the next step.
2. **Tabletop turntable motions** for each physical axis: clockwise 90°,
   counterclockwise 90°, and clockwise 180°. The selected positive face points
   upward along the table normal. The ±90° motions fit axis direction; 180° is
   held out because its terminal pose cannot distinguish +180° from -180°.
3. **Free-air compound validation**: start at white-up/green-front, cover pitch,
   yaw, and roll for at least six seconds, then return to the same tabletop
   reference. This trajectory is not fitted. It measures three-axis coverage,
   composition correctness, and return-to-reference drift.

The discrete solver uses all valid static poses and only the ±90° direction
evidence. A model is forbidden from becoming active when mean static residual
exceeds 10° or maximum residual exceeds 20°. The 180° and compound trajectory
remain validation evidence, so the solver cannot improve its score by fitting
its own test set.

If the physical start and end pose are the same but the sensor quaternion has a
large return error, the failure is temporal IMU/session drift rather than an
axis mapping problem. The correct remedy is a session anchor or sensor fusion,
not a larger static correction matrix.

### Sampling and loss compensation

GAN16 V4 orientation notifications are typically about 11.4 Hz. They are
absolute orientations, so a missing intermediate notification does not require
host-side angle integration: the next quaternion is still the latest absolute
pose. Compensation is deliberately split by responsibility:

- **Renderer only**: SLERP from the displayed pose toward the latest canonical
  pose at the display refresh rate. These visual interpolation frames are never
  persisted, logged, fitted, or counted as BLE samples.
- **Calibration**: score static coverage by elapsed stable time rather than an
  assumed sample count. Accept quaternion steps up to 75° so a fast 90° turn at
  low notification rate is not discarded. Ignore deltas separated by more than
  500 ms, because they cross an unobserved gap.
- **Sticker state**: never interpolate layer moves. Move-counter gaps trigger a
  full cube snapshot and domain-state resynchronization.
- **Long gaps**: freeze at the latest absolute orientation. Do not extrapolate
  indefinitely from estimated angular velocity; GAN16 currently reports zero
  angular velocity, and runaway prediction is worse than a short visual hold.

## 5. Renderer boundary

The production 3D renderer is Three.js WebGL. Three.js consumes the canonical
right-handed, Y-up `R_cube_pose` directly on the inner pose group. The outer
view group owns camera-like user dragging. Neither group writes into the other,
and no CSS transform participates in the production pose path.

```text
canonical R_cube_pose → Three.js poseGroup.quaternion → WebGL
manual orbit          → Three.js viewGroup.quaternion → WebGL
```

### Legacy CSS/debug serialization

CSS coordinates use positive Y down, while the canonical cube uses positive Y
up. The DOM cube geometry consequently represents canonical cube vectors in
CSS coordinates through:

```text
S_cube_to_css = diag(1, -1, 1)
```

If a debug surface or non-WebGL fallback serializes a canonical pose to CSS, it
must convert it only at that boundary:

```text
R_css = S_cube_to_css · R_cube_pose · S_cube_to_css
```

`matrix3d(...)` is serialized in column-major order, as required by CSS
Transforms. Camera/view dragging is CSS-native UI state and is composed
separately from `R_cube_pose`; it must never be written back into calibration.

## 6. Ownership boundaries

```text
BLE packet
  → GAN parser: normalized sensor quaternion
  → pose calibration: canonical CubePose
  → trainer store: latest CubePose SSOT
  → renderer adapter: CSS matrix3d
```

The following are prohibited outside the named owner:

- packet component reorder: GAN parser only;
- quaternion relative order: pose calibration only;
- sensor/cube axis mapping: pose calibration only;
- CSS Y reflection and column-major serialization: renderer adapter only;
- manual camera drag: `Cube3D` view state only.

## 7. Required tests

The pose model is not considered covered by a single screenshot. Tests must
lock down:

- quaternion normalization and composition order;
- identity at the captured reference pose;
- six declared top/front static poses;
- three controlled positive-face clockwise rotations;
- orthonormality and determinant `+1` for every produced cube pose;
- canonical cube-to-CSS Y reflection;
- CSS `matrix3d` column-major serialization;
- persisted calibration reload for the same physical device.

## References

- CSS Transforms Module Level 2 — `matrix3d` is a 4×4 homogeneous matrix in
  column-major order; transform functions are post-multiplied:
  <https://drafts.csswg.org/css-transforms-2/>
- MDN transform functions — CSS Cartesian coordinates have the origin at the
  top-left and positive coordinates go down and right:
  <https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function>
- MDN `matrix3d()` — 16 values are specified in column-major order:
  <https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/matrix3d>
- ROS 2 tf2 quaternion fundamentals — inversion, multiplication order, and
  relative rotation:
  <https://docs.ros.org/en/rolling/Tutorials/Intermediate/Tf2/Quaternion-Fundamentals.html>
- SciPy `Rotation` — active application to vectors and composition order:
  <https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.transform.Rotation.html>
- Three.js math primitives used by the implementation:
  <https://threejs.org/docs/#api/en/math/Quaternion>
