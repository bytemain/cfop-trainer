export type CaseKind = "oll" | "pll";

export interface CasePattern {
  /** U-face stickers that show the last-layer color, row-major. */
  top: readonly boolean[];
  /** Twelve side stickers around the U layer, ordered F → R → B → L. */
  ring: readonly boolean[];
  /** Optional PLL side-row colors, ordered F → R → B → L. */
  ringColors?: readonly ("green" | "red" | "blue" | "orange")[];
}

export interface CaseAlgorithm {
  id: string;
  label: string;
  segments: readonly string[];
  note?: string;
}

export interface CfopCase {
  id: string;
  kind: CaseKind;
  number: number;
  name: string;
  aliases: readonly string[];
  family: string;
  tags: readonly string[];
  recognition: string;
  pattern: CasePattern;
  algorithms: readonly CaseAlgorithm[];
}

export interface CaseFilters {
  kind: CaseKind;
  query: string;
  family: string;
}

const ring = (...yellowIndexes: number[]): readonly boolean[] =>
  Array.from({ length: 12 }, (_, index) => yellowIndexes.includes(index));

const top = (value: string): readonly boolean[] =>
  [...value].map((sticker) => sticker === "1");

const pllRing = (value: string): readonly ("green" | "red" | "blue" | "orange")[] => {
  const colors = { G: "green", R: "red", B: "blue", O: "orange" } as const;
  return [...value].map((color) => colors[color as keyof typeof colors]);
};

export const CASE_LIBRARY: readonly CfopCase[] = [
  {
    id: "oll-21", kind: "oll", number: 21, name: "H", aliases: ["Cross H"],
    family: "十字", tags: ["2-Look", "十字", "纯棱"],
    recognition: "顶面是十字；四个顶层角都未朝上，侧面黄色形成两组对称双灯。",
    pattern: { top: top("010111010"), ring: ring(0, 2, 6, 8) },
    algorithms: [
      { id: "oll-21-a", label: "标准", segments: ["R U2 R'", "U' R U R'", "U' R U' R'"] },
    ],
  },
  {
    id: "oll-22", kind: "oll", number: 22, name: "Pi", aliases: ["Pi Shape"],
    family: "十字", tags: ["2-Look", "十字", "Pi"],
    recognition: "顶面是十字；两个相邻角朝上，另外两个角在左右侧形成一对外灯。",
    pattern: { top: top("110111010"), ring: ring(3, 8) },
    algorithms: [
      { id: "oll-22-a", label: "标准", segments: ["R U2", "R2 U' R2", "U' R2 U2 R"] },
    ],
  },
  {
    id: "oll-23", kind: "oll", number: 23, name: "Headlights", aliases: ["车灯"],
    family: "十字", tags: ["2-Look", "十字", "车灯"],
    recognition: "顶面是十字；后侧两个角朝上，前侧两个黄色贴纸正对你，像一对车灯。",
    pattern: { top: top("111111010"), ring: ring(0, 2) },
    algorithms: [
      { id: "oll-23-a", label: "标准", segments: ["R2 D", "R' U2 R", "D' R' U2 R'"] },
    ],
  },
  {
    id: "oll-24", kind: "oll", number: 24, name: "T", aliases: ["T Shape"],
    family: "十字", tags: ["2-Look", "十字", "T形"],
    recognition: "顶面黄色组成 T；两个未朝上的角位于同一侧，侧面黄色方向相反。",
    pattern: { top: top("010111111"), ring: ring(3, 11) },
    algorithms: [
      { id: "oll-24-a", label: "标准", segments: ["r U R' U'", "r' F R F'"] },
    ],
  },
  {
    id: "oll-25", kind: "oll", number: 25, name: "Bowtie", aliases: ["蝴蝶结"],
    family: "十字", tags: ["2-Look", "十字", "蝴蝶结"],
    recognition: "顶面两个对角角块朝上，轮廓像蝴蝶结；另外两个黄色贴纸分居相对侧。",
    pattern: { top: top("110111011"), ring: ring(3, 9) },
    algorithms: [
      { id: "oll-25-a", label: "标准", segments: ["F'", "r U R' U'", "r' F R"] },
    ],
  },
  {
    id: "oll-26", kind: "oll", number: 26, name: "Anti-Sune", aliases: ["逆小鱼", "Anti Sune"],
    family: "点形", tags: ["2-Look", "小鱼", "单角朝上"],
    recognition: "只有一个顶层角朝上；把朝上的角放在左前，左侧会看到两个黄色贴纸。",
    pattern: { top: top("000010001"), ring: ring(0, 5, 9, 11) },
    algorithms: [
      { id: "oll-26-a", label: "标准", segments: ["R U2 R'", "U' R U' R'"] },
      { id: "oll-26-b", label: "左手", segments: ["L' U' L", "U' L' U2 L"], note: "左右手镜像手感" },
    ],
  },
  {
    id: "oll-27", kind: "oll", number: 27, name: "Sune", aliases: ["小鱼"],
    family: "点形", tags: ["2-Look", "小鱼", "单角朝上"],
    recognition: "只有一个顶层角朝上；把朝上的角放在右前，右侧会看到两个黄色贴纸。",
    pattern: { top: top("001010000"), ring: ring(2, 3, 6, 8) },
    algorithms: [
      { id: "oll-27-a", label: "标准", segments: ["R U R'", "U R U2 R'"] },
    ],
  },
  {
    id: "pll-h", kind: "pll", number: 1, name: "H Perm", aliases: ["H置换"],
    family: "棱置换", tags: ["2-Look", "纯棱", "对棱交换"],
    recognition: "四个角都已归位；四条棱两两对换，四个侧面都没有完整三色条。",
    pattern: { top: top("111111111"), ring: ring(), ringColors: pllRing("GBGRORBOBGRO") },
    algorithms: [
      { id: "pll-h-a", label: "M 层", segments: ["M2 U", "M2 U2", "M2 U", "M2"] },
    ],
  },
  {
    id: "pll-ua", kind: "pll", number: 2, name: "Ua Perm", aliases: ["U顺", "Ua"],
    family: "棱置换", tags: ["2-Look", "纯棱", "三棱循环"],
    recognition: "四角均归位；找到一条完整侧面放在后面，其余三条棱顺时针循环。",
    pattern: { top: top("111111111"), ring: ring(), ringColors: pllRing("GRGROBRBOOBG") },
    algorithms: [
      { id: "pll-ua-a", label: "M 层", segments: ["M2 U", "M U2", "M' U", "M2"] },
    ],
  },
  {
    id: "pll-ub", kind: "pll", number: 3, name: "Ub Perm", aliases: ["U逆", "Ub"],
    family: "棱置换", tags: ["2-Look", "纯棱", "三棱循环"],
    recognition: "四角均归位；找到一条完整侧面放在后面，其余三条棱逆时针循环。",
    pattern: { top: top("111111111"), ring: ring(), ringColors: pllRing("GOGRRBBORBOG") },
    algorithms: [
      { id: "pll-ub-a", label: "M 层", segments: ["M2 U'", "M U2", "M' U'", "M2"] },
    ],
  },
  {
    id: "pll-t", kind: "pll", number: 4, name: "T Perm", aliases: ["T置换"],
    family: "角棱混合", tags: ["相邻角交换", "相邻棱交换", "高频"],
    recognition: "一侧有完整三色条；对面是一组车灯，剩余一对角和一对棱交换。",
    pattern: { top: top("111111111"), ring: ring(), ringColors: pllRing("GRGRORBBBGRO") },
    algorithms: [
      { id: "pll-t-a", label: "标准", segments: ["R U R' U'", "R' F", "R2 U' R' U'", "R U R' F'"] },
    ],
  },
  {
    id: "pll-y", kind: "pll", number: 5, name: "Y Perm", aliases: ["Y置换"],
    family: "角棱混合", tags: ["对角交换", "相邻棱交换"],
    recognition: "没有完整三色条；一组对角角块交换，同时有一对相邻棱交换。",
    pattern: { top: top("111111111"), ring: ring(), ringColors: pllRing("GORRRGBBOBGO") },
    algorithms: [
      { id: "pll-y-a", label: "标准", segments: ["F R U' R' U'", "R U R' F'", "R U R' U'", "R' F R F'"] },
    ],
  },
  {
    id: "pll-aa", kind: "pll", number: 6, name: "Aa Perm", aliases: ["Aa"],
    family: "角置换", tags: ["2-Look", "纯角", "三角循环"],
    recognition: "四条棱均归位；找到同色车灯放在后侧，三个角逆时针循环。",
    pattern: { top: top("111111111"), ring: ring(), ringColors: pllRing("ORGRRGBOBBOG") },
    algorithms: [
      { id: "pll-aa-a", label: "标准", segments: ["x", "R' U R'", "D2 R U' R'", "D2 R2", "x'"] },
    ],
  },
  {
    id: "pll-ab", kind: "pll", number: 7, name: "Ab Perm", aliases: ["Ab"],
    family: "角置换", tags: ["2-Look", "纯角", "三角循环"],
    recognition: "四条棱均归位；找到同色车灯放在后侧，三个角顺时针循环。",
    pattern: { top: top("111111111"), ring: ring(), ringColors: pllRing("RGGOORBRBBGO") },
    algorithms: [
      { id: "pll-ab-a", label: "标准", segments: ["x", "R2 D2", "R U R'", "D2 R U' R", "x'"] },
    ],
  },
];

export function familiesFor(kind: CaseKind): string[] {
  return [...new Set(CASE_LIBRARY.filter((item) => item.kind === kind).map((item) => item.family))];
}

export function filterCases(filters: CaseFilters): CfopCase[] {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return CASE_LIBRARY.filter((item) => {
    if (item.kind !== filters.kind) return false;
    if (filters.family !== "all" && item.family !== filters.family) return false;
    if (!query) return true;
    const searchable = [
      item.id,
      item.name,
      ...item.aliases,
      item.family,
      ...item.tags,
      item.recognition,
      ...item.algorithms.flatMap((algorithm) => [algorithm.label, ...algorithm.segments]),
    ].join(" ").toLocaleLowerCase("zh-CN");
    return searchable.includes(query);
  });
}

export function selectCase(
  currentId: string | null,
  visibleCases: readonly CfopCase[],
): CfopCase | null {
  if (visibleCases.length === 0) return null;
  return visibleCases.find((item) => item.id === currentId) ?? visibleCases[0];
}

export function algorithmMoves(algorithm: CaseAlgorithm): string[] {
  return algorithm.segments.flatMap((segment) => segment.trim().split(/\s+/).filter(Boolean));
}
