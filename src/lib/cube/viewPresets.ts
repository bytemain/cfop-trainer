/**
 * Default camera angle presets for the 3D cube view. pitch rotates around X
 * (tilts the top face toward the viewer), yaw rotates around Y (swings the
 * right face into view) — matching Cube3D's resetView Euler order.
 */

export type ViewPresetId = "front" | "subtle" | "standard" | "isometric" | "overhead";

export interface ViewPreset {
  id: ViewPresetId;
  label: string;
  hint: string;
  pitchDeg: number;
  yawDeg: number;
}

export const VIEW_PRESETS: readonly ViewPreset[] = [
  { id: "front", label: "正视", hint: "正面直视，无透视", pitchDeg: 0, yawDeg: 0 },
  { id: "subtle", label: "轻斜", hint: "轻微透视，正面为主", pitchDeg: 16, yawDeg: 24 },
  { id: "standard", label: "标准", hint: "三面可见的经典视角", pitchDeg: 24, yawDeg: 34 },
  { id: "isometric", label: "等距", hint: "三面均匀的正等距", pitchDeg: 35, yawDeg: 45 },
  { id: "overhead", label: "俯视", hint: "高位俯看，顶面为主", pitchDeg: 55, yawDeg: 45 },
];

export const DEFAULT_VIEW_PRESET_ID: ViewPresetId = "standard";

export function viewPresetById(id: string | null | undefined): ViewPreset {
  return VIEW_PRESETS.find((preset) => preset.id === id)
    ?? VIEW_PRESETS.find((preset) => preset.id === DEFAULT_VIEW_PRESET_ID)!;
}
