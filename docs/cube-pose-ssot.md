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

The sensor quaternion alone is not a `CubePose`. Persistent device calibration owns exactly two
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

Runtime state is split into three independent records:

- `DeviceCalibration`: persistent sensor-to-cube mapping, relative order and residuals;
- `SessionAnchor`: in-memory sensor reference plus the canonical pose it represents;
- `ViewPreference`: persistent camera offsets/inversion controls, never protocol evidence.

`SessionAnchor` is recreated for a new physical sensor session and retained by
the HMR-preserved store while the Rust BLE connection remains alive. A long
background gap is checked before the next quaternion is accepted. If the
sensor frame appears to have reset, the new sensor reference is anchored to
the last accepted canonical pose so the renderer cannot jump arbitrarily.

The multiplication order is data, not an implementation detail. ROS tf2 also
defines a relative rotation that takes `q1` to `q2` as
`q_relative = q2 × inverse(q1)` and explicitly warns that order matters.

## 4. Calibration solver

The solver must jointly choose `relativeOrder` and `bodyToModel`. It may not
derive one in the protocol parser and silently compensate for it in the UI.

For the current GAN calibration flow it evaluates both:

```text
2 relative orders × 24 proper signed-axis rotations
2 relative orders × weighted Wahba/Kabsch continuous SO(3) fits
```

Each candidate is scored against:

- all captured static `top/front` poses as complete 3D rotations;
- all Pose Graph start/end pairs as complete relative rotations.

Legacy dynamic-axis summaries are diagnostics; they are not by themselves a
complete pose model. A calibration persists pose and full-edge angular
residuals so a poor capture cannot masquerade as an exact mapping.

Every static capture also receives an individual residual. Outliers can be
recaptured without discarding the remaining profile. Dynamic trajectories
retain their normalized three-component axis vector; reducing them to only a
dominant signed axis is insufficient for a continuous mounting solution.

### Calibration protocol V3: Pose Graph

The capture UI must provide enough independent excitation to distinguish a
rigid pose model from a mapping that only happens to work near one grip:

1. **One semantic anchor**: white up, green front. This explicitly binds the
   protocol sensor frame to the user's physical color convention.
2. **24 continuous free-air pose edges**: visit all 24 legal `top/front` poses
   exactly once along a Hamiltonian path of 90° whole-cube transitions. Every
   edge starts at the previous edge's endpoint, so the user never resets to a
   fixed grip. The cube may be held in the air and follow any natural path;
   only the stable semantic endpoints are solver evidence. The intermediate
   quaternion stream is coverage diagnostics, never a claimed body axis. A
   final 180° edge returns to white-up/green-front and closes the graph.
3. **Free-air compound validation**: start at white-up/green-front, cover pitch,
   yaw, and roll for at least six seconds, then return in-hand to the same
   semantic pose. This trajectory is not fitted. It measures calibrated
   cube-body-axis coverage, composition correctness, return tilt, and absolute
   reference drift.

The continuous sequence covers all 24 legal nodes without repeated setup.
Optional repeated endpoints are loop-closure observations. Their pairwise
absolute angular error is persisted as diagnostics, but is not a hard gate
because session drift is temporally distinct from the rigid axis mapping.

The solver uses the best observation for every generated pose node and scores
each dynamic edge as a complete start-to-end SO(3) delta. Legacy dominant-axis
summaries remain exportable diagnostics but cannot veto an otherwise
well-constrained Pose Graph: a tabletop turn around gravity can legitimately
make every raw summary look like the same world axis. A model is forbidden from
becoming active when mean pose residual exceeds 10°, maximum pose residual
exceeds 20°, or mean fitted 90° edge error exceeds 15°. The closing 180° edge
and compound trajectory remain held-out validation evidence, so the solver
cannot improve its score by fitting its own test set.

If the physical start and end pose are the same but the sensor quaternion has a
large absolute return error, the failure is temporal IMU/session drift rather
than an axis mapping problem. Compound validation therefore gates completion on
the cube returning to the declared white-up/green-front pose. The full
quaternion return error remains a diagnostic and must not override a correctly
recognized semantic pose merely because of session drift.

During compound validation the already-solved `bodyToModel` maps every
frame-to-frame quaternion delta into canonical cube-body X/Y/Z before coverage
is accumulated. Raw protocol x/y/z energy is not meaningful coverage evidence
until that calibration boundary has been crossed.

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
- **Health gate**: reject non-finite/non-unit packets and implausible >105°
  single-frame jumps at normal cadence. Quaternion sign flips `q ↔ -q` are
  aligned before comparison and are never treated as motion.

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
- the white-up/green-front semantic anchor;
- three controlled positive-face clockwise rotations;
- 24 continuous free-air edges visiting exactly 24 unique legal pose nodes and
  returning to the semantic anchor;
- stable edge endpoints and loop-closure error summaries;
- rejection of any dynamic edge contaminated by a layer move;
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
