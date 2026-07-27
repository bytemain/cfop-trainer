import { executeMoves, invertTokens, tokenizeAlgorithm } from "$lib/cube/algorithm";
import {
  type CubeState,
  type Face,
  type StickerColor,
} from "$lib/cube/cube";

export type CaseKind = "oll" | "pll";

export interface CasePattern {
  /** U-face stickers that show the last-layer color, row-major. */
  top: readonly boolean[];
  /** Twelve side stickers around the U layer, ordered F → R → B → L. */
  ring: readonly boolean[];
  /** PLL side-row colors, ordered F → R → B → L. */
  ringColors?: readonly StickerColor[];
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
  /**
   * Canonical case state in diagram space (yellow up, green front, red
   * right). Derived from the inverse of the first algorithm, so the
   * displayed diagram and the listed solution always agree.
   */
  cube: CubeState;
}

export interface CaseFilters {
  kind: CaseKind;
  query: string;
  family: string;
}

/**
 * Diagram space: the learning diagrams are drawn yellow-up / green-front the
 * way every CFOP chart does, while the trainer's solved state is white-up.
 */
function diagramSolved(): CubeState {
  const face = (color: StickerColor) => Array<StickerColor>(9).fill(color);
  return {
    U: face("yellow"),
    R: face("red"),
    F: face("green"),
    D: face("white"),
    L: face("orange"),
    B: face("blue"),
  };
}

function deriveCaseCube(algorithm: string): CubeState {
  return executeMoves(diagramSolved(), invertTokens(tokenizeAlgorithm(algorithm)));
}

function derivePattern(kind: CaseKind, cube: CubeState): CasePattern {
  const topColor = cube.U[4];
  const top = cube.U.map((color) => color === topColor);
  const ring: boolean[] = [];
  const ringColors: StickerColor[] = [];
  for (const face of ["F", "R", "B", "L"] as Face[]) {
    for (let index = 0; index < 3; index += 1) {
      ring.push(cube[face][index] === topColor);
      ringColors.push(cube[face][index]);
    }
  }
  return kind === "pll" ? { top, ring, ringColors } : { top, ring };
}

function segmentize(algorithm: string): string[] {
  const tokens = tokenizeAlgorithm(algorithm);
  const segments: string[] = [];
  for (let index = 0; index < tokens.length; index += 4) {
    segments.push(tokens.slice(index, index + 4).join(" "));
  }
  return segments;
}

interface CaseDeclaration {
  kind: CaseKind;
  number: number;
  slug?: string;
  name: string;
  aliases?: readonly string[];
  family: string;
  tags?: readonly string[];
  recognition: string;
  algorithms: ReadonlyArray<{ label?: string; algorithm: string; note?: string }>;
}

function buildCase(declaration: CaseDeclaration): CfopCase {
  const id = declaration.kind === "oll"
    ? `oll-${declaration.number}`
    : `pll-${declaration.slug ?? declaration.name.toLowerCase().replace(/\s+/g, "")}`;
  const cube = deriveCaseCube(declaration.algorithms[0].algorithm);
  return {
    id,
    kind: declaration.kind,
    number: declaration.number,
    name: declaration.name,
    aliases: declaration.aliases ?? [],
    family: declaration.family,
    tags: declaration.tags ?? [declaration.family, "Full"],
    recognition: declaration.recognition,
    pattern: derivePattern(declaration.kind, cube),
    cube,
    algorithms: declaration.algorithms.map((algorithm, index) => ({
      id: `${id}-${String.fromCharCode(97 + index)}`,
      label: algorithm.label ?? "标准",
      segments: segmentize(algorithm.algorithm),
      note: algorithm.note,
    })),
  };
}

const oll = (declaration: Omit<CaseDeclaration, "kind">) =>
  buildCase({ ...declaration, kind: "oll" });
const pll = (declaration: Omit<CaseDeclaration, "kind">) =>
  buildCase({ ...declaration, kind: "pll" });

export const CASE_LIBRARY: readonly CfopCase[] = [
  // ------------------------------------------------------------- OLL 1-20 点形
  oll({
    number: 1, name: "Runway", aliases: ["跑道"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。侧面黄色集中在同一侧的两格，像一条跑道，另一侧两格黄色与其相对。",
    algorithms: [{ algorithm: "R U2 R2 F R F' U2 R' F R F'" }],
  }),
  oll({
    number: 2, name: "Zamboni", aliases: ["桑巴尼"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。侧面黄色形成两组相邻的双灯，整体轮廓像 Z 字。",
    algorithms: [
      { algorithm: "r U r' U2 r U2 R' U2 R U' r'" },
      { algorithm: "y' F R U R' U' F' f R U R' U' f'", note: "双 F 触发版本" },
    ],
  }),
  oll({
    number: 3, name: "Anti-Pinwheel", aliases: ["反风车", "Anti-Mouse"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。三个侧面各露黄色，风车状逆时针分布。",
    algorithms: [
      { algorithm: "r' R2 U R' U r U2 r' U M'" },
      { algorithm: "y' f R U R' U' f' U' F R U R' U' F'", note: "纯面转版本" },
    ],
  }),
  oll({
    number: 4, name: "Pinwheel", aliases: ["风车", "Mouse"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。三个侧面各露黄色，风车状顺时针分布，与 OLL 3 镜像。",
    algorithms: [
      { algorithm: "M U' r U2 r' U' R U' R' M'" },
      { algorithm: "y' f R U R' U' f' U F R U R' U' F'", note: "纯面转版本" },
    ],
  }),
  oll({
    number: 5, name: "Righty Square", aliases: ["右方块"], family: "方块",
    recognition: "方块形：顶面有两个相邻黄色棱。黄色方块块在左后，右侧有一对黄色侧贴。",
    algorithms: [
      { algorithm: "l' U2 L U L' U l" },
      { algorithm: "y2 r' U2 R U R' U r", note: "右手版本（先 y2）" },
    ],
  }),
  oll({
    number: 6, name: "Lefty Square", aliases: ["左方块"], family: "方块",
    recognition: "方块形：顶面有两个相邻黄色棱。黄色方块块在右后，左侧有一对黄色侧贴，与 OLL 5 镜像。",
    algorithms: [{ algorithm: "r U2 R' U' R U' r'" }],
  }),
  oll({
    number: 7, name: "Wide Sune", aliases: ["宽小鱼", "小闪电"], family: "小闪电",
    recognition: "小闪电：顶面一个黄色棱 + 两个黄色角相邻。闪电头指向右侧，像加宽版小鱼。",
    algorithms: [{ algorithm: "r U R' U R U2 r'" }],
  }),
  oll({
    number: 8, name: "Wide Anti-Sune", aliases: ["宽反小鱼", "小闪电"], family: "小闪电",
    recognition: "小闪电：顶面一个黄色棱 + 两个黄色角相邻。闪电头指向左侧，与 OLL 7 镜像。",
    algorithms: [
      { algorithm: "l' U' L U' L' U2 l" },
      { algorithm: "R U2 R' U2 R' F R F'", note: "纯面转版本" },
    ],
  }),
  oll({
    number: 9, name: "Kite", aliases: ["风筝"], family: "鱼形",
    recognition: "鱼形：顶面一个黄色棱 + 两个对角黄色角。风筝尾巴在右侧，侧面两黄相邻。",
    algorithms: [{ algorithm: "R U R' U' R' F R2 U R' U' F'" }],
  }),
  oll({
    number: 10, name: "Anti-Kite", aliases: ["反风筝"], family: "鱼形",
    recognition: "鱼形：顶面一个黄色棱 + 两个对角黄色角。风筝尾巴在左侧，与 OLL 9 镜像。",
    algorithms: [{ algorithm: "R U R' U R' F R F' R U2 R'" }],
  }),
  oll({
    number: 11, name: "Upstairs", aliases: ["上楼"], family: "小闪电",
    recognition: "小闪电：顶面一个黄色棱 + 两个对角黄色角。侧面黄色像上楼的台阶。",
    algorithms: [
      { algorithm: "r U R' U R' F R F' R U2 r'" },
      { algorithm: "y2 r' R2 U R' U R U2 R' U M'", note: "M 层版本（先 y2）" },
    ],
  }),
  oll({
    number: 12, name: "Downstairs", aliases: ["下楼"], family: "小闪电",
    recognition: "小闪电：顶面一个黄色棱 + 两个对角黄色角。侧面黄色像下楼的台阶，与 OLL 11 镜像。",
    algorithms: [{ algorithm: "M' R' U' R U' R' U2 R U' R r'" }],
  }),
  oll({
    number: 13, name: "Gun", aliases: ["枪", "骑士"], family: "骑士",
    recognition: "骑士形：顶面两个相邻黄色角。侧面黄色构成骑士（马步）形状，枪口朝右。",
    algorithms: [
      { algorithm: "F U R U' R2 F' R U R U' R'" },
      { algorithm: "r U' r' U' r U r' y' R' U R", note: "宽转版本" },
    ],
  }),
  oll({
    number: 14, name: "Anti-Gun", aliases: ["反枪", "骑士"], family: "骑士",
    recognition: "骑士形：顶面两个相邻黄色角。骑士形状镜像，枪口朝左。",
    algorithms: [{ algorithm: "R' F R U R' F' R F U' F'" }],
  }),
  oll({
    number: 15, name: "Squeegee", aliases: ["刮板", "骑士"], family: "骑士",
    recognition: "骑士形：顶面两个相邻黄色角。侧面黄色呈马步分布，刮板朝左。",
    algorithms: [
      { algorithm: "l' U' l L' U' L U l' U l" },
      { algorithm: "y2 r' U' r R' U' R U r' U r", note: "右手版本（先 y2）" },
    ],
  }),
  oll({
    number: 16, name: "Anti-Squeegee", aliases: ["反刮板", "骑士"], family: "骑士",
    recognition: "骑士形：顶面两个相邻黄色角。马步分布镜像，刮板朝右。",
    algorithms: [{ algorithm: "r U r' R U R' U' r U' r'" }],
  }),
  oll({
    number: 17, name: "Slash", aliases: ["斜线"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。侧面黄色排成一条斜线。",
    algorithms: [
      { algorithm: "F R' F' R2 r' U R U' R' U' M'" },
      { algorithm: "y2 R U R' U R' F R F' U2 R' F R F'", note: "纯面转版本（先 y2）" },
    ],
  }),
  oll({
    number: 18, name: "Crown", aliases: ["皇冠"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。侧面黄色像一顶皇冠，三个方向露黄。",
    algorithms: [{ algorithm: "r U R' U R U2 r2 U' R U' R' U2 r" }],
  }),
  oll({
    number: 19, name: "Bunny", aliases: ["兔子"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。侧面黄色像兔子的两只耳朵。",
    algorithms: [{ algorithm: "r' R U R U R' U' M' R' F R F'" }],
  }),
  oll({
    number: 20, name: "X", aliases: ["X 形", "棋盘"], family: "点形",
    recognition: "点形：顶面没有黄色棱块。四个侧面各露一个黄色，呈 X 分布。",
    algorithms: [{ algorithm: "r U R' U' M2 U R U' R' U' M'" }],
  }),
  // --------------------------------------------------------- OLL 21-27 十字
  oll({
    number: 21, name: "H", aliases: ["Double Sune", "双小鱼"], family: "十字",
    tags: ["2-Look", "十字", "纯棱"],
    recognition: "顶面是十字；四个顶层角都未朝上，侧面黄色形成两组对称双灯。",
    algorithms: [{ algorithm: "R U2 R' U' R U R' U' R U' R'" }],
  }),
  oll({
    number: 22, name: "Pi", aliases: ["派"], family: "十字",
    tags: ["2-Look", "十字", "Pi"],
    recognition: "顶面是十字；两个相邻角朝上，另外两个角在左右侧形成一对外灯。",
    algorithms: [{ algorithm: "R U2 R2 U' R2 U' R2 U2 R" }],
  }),
  oll({
    number: 23, name: "Headlights", aliases: ["车灯", "Superman"], family: "十字",
    tags: ["2-Look", "十字", "车灯"],
    recognition: "顶面是十字；后侧两个角朝上，前侧两个黄色贴纸正对你，像一对车灯。",
    algorithms: [
      { algorithm: "R2 D R' U2 R D' R' U2 R'" },
      { algorithm: "y2 R2 D' R U2 R' D R U2 R", note: "车灯在后侧的起手（先 y2）" },
    ],
  }),
  oll({
    number: 24, name: "T", aliases: ["Chameleon"], family: "十字",
    tags: ["2-Look", "十字", "T形"],
    recognition: "顶面黄色组成 T；两个未朝上的角位于同一侧，侧面黄色方向相反。",
    algorithms: [{ algorithm: "r U R' U' r' F R F'" }],
  }),
  oll({
    number: 25, name: "Bowtie", aliases: ["蝴蝶结"], family: "十字",
    tags: ["2-Look", "十字", "蝴蝶结"],
    recognition: "顶面两个对角角块朝上，轮廓像蝴蝶结；另外两个黄色贴纸分居相对侧。",
    algorithms: [{ algorithm: "F' r U R' U' r' F R" }],
  }),
  oll({
    number: 26, name: "Anti-Sune", aliases: ["反小鱼", "逆小鱼"], family: "十字",
    tags: ["2-Look", "小鱼", "单角朝上"],
    recognition: "只有一个顶层角朝上；把朝上的角放在左前，左侧会看到两个黄色贴纸。",
    algorithms: [
      { algorithm: "R U2 R' U' R U' R'" },
      { algorithm: "y' R' U' R U' R' U2 R", note: "右手镜像（先 y'）" },
    ],
  }),
  oll({
    number: 27, name: "Sune", aliases: ["小鱼"], family: "十字",
    tags: ["2-Look", "小鱼", "单角朝上"],
    recognition: "只有一个顶层角朝上；把朝上的角放在右前，右侧会看到两个黄色贴纸。",
    algorithms: [
      { algorithm: "R U R' U R U2 R'" },
      { algorithm: "y' R' U2 R U R' U R", note: "镜像版本（先 y'）" },
    ],
  }),
  // ------------------------------------------------------ OLL 28-57 角块已定向
  oll({
    number: 28, name: "Mummy", aliases: ["木乃伊"], family: "顶角定向",
    recognition: "四个角全部朝上；顶面黄色呈一条直线加一侧两格，侧面黄色像缠绕的绷带。",
    algorithms: [{ algorithm: "r U R' U' r' R U R U' R'" }],
  }),
  oll({
    number: 29, name: "Spotted Chameleon", aliases: ["斑点变色龙"], family: "扭曲",
    recognition: "两个对角角块朝上；侧面黄色一前一后错开，像变色龙身上的斑点。",
    algorithms: [{ algorithm: "R U R' U' R U' R' F' U' F R U R'" }],
  }),
  oll({
    number: 30, name: "Anti-Spotted Chameleon", aliases: ["反斑点变色龙"], family: "扭曲",
    recognition: "两个对角角块朝上；侧面黄色错位方向与 OLL 29 相反。",
    algorithms: [
      { algorithm: "F R' F R2 U' R' U' R U R' F2" },
      { algorithm: "F U R U2 R' U' R U2 R' U' F'", note: "F 触发版本" },
    ],
  }),
  oll({
    number: 31, name: "Couch", aliases: ["沙发", "P形"], family: "P形",
    recognition: "P 形：顶面两个相邻角朝上。侧面黄色构成 P 字，开口朝右。",
    algorithms: [{ algorithm: "R' U' F U R U' R' F' R" }],
  }),
  oll({
    number: 32, name: "Anti-Couch", aliases: ["反沙发", "P形"], family: "P形",
    recognition: "P 形：顶面两个相邻角朝上。P 字开口朝左，与 OLL 31 镜像。",
    algorithms: [{ algorithm: "L U F' U' L' U L F L'" }],
  }),
  oll({
    number: 33, name: "Suit Up", aliases: ["T形"], family: "T形",
    tags: ["2-Look", "T形", "高频"],
    recognition: "T 形：顶面两个相邻角朝上；侧面一对黄色正对车灯方向，像领带。",
    algorithms: [{ algorithm: "R U R' U' R' F R F'" }],
  }),
  oll({
    number: 34, name: "City", aliases: ["城市", "C形"], family: "C形",
    recognition: "C 形：顶面两个相邻角朝上；侧面黄色组成 C 字轮廓。",
    algorithms: [
      { algorithm: "R U R2 U' R' F R U R U' F'" },
      { algorithm: "R U R' U' B' R' F R F' B", note: "B 层版本" },
    ],
  }),
  oll({
    number: 35, name: "Fish Salad", aliases: ["鱼沙拉"], family: "鱼形",
    recognition: "鱼形：顶面两个相邻角朝上；侧面黄色像一条被切开的鱼。",
    algorithms: [{ algorithm: "R U2 R2 F R F' R U2 R'" }],
  }),
  oll({
    number: 36, name: "Wario", aliases: ["瓦里奥", "W形"], family: "W形",
    recognition: "W 形：顶面两个相邻角朝上；侧面黄色排成 W 的左半边。",
    algorithms: [
      { algorithm: "L' U' L U' L' U L U L F' L' F" },
      { algorithm: "y2 R' U' R U' R' U R U R B' R' B", note: "右手版本（先 y2）" },
    ],
  }),
  oll({
    number: 37, name: "Mounted Fish", aliases: ["挂鱼"], family: "鱼形",
    recognition: "鱼形：顶面两个相邻角朝上；侧面黄色一左一右挂在顶面两侧。",
    algorithms: [
      { algorithm: "F R' F' R U R U' R'" },
      { algorithm: "F R U' R' U' R U R' F'", note: "常见替代" },
    ],
  }),
  oll({
    number: 38, name: "Mario", aliases: ["马里奥", "W形"], family: "W形",
    recognition: "W 形：顶面两个相邻角朝上；侧面黄色排成 W 的右半边，与 OLL 36 镜像。",
    algorithms: [{ algorithm: "R U R' U R U' R' U' R' F R F'" }],
  }),
  oll({
    number: 39, name: "Fung", aliases: ["大闪电"], family: "大闪电",
    recognition: "大闪电：顶面两个相邻角朝上；侧面黄色连成一道大闪电，头朝左。",
    algorithms: [{ algorithm: "L F' L' U' L U F U' L'" }],
  }),
  oll({
    number: 40, name: "Anti-Fung", aliases: ["反大闪电"], family: "大闪电",
    recognition: "大闪电：顶面两个相邻角朝上；闪电头朝右，与 OLL 39 镜像。",
    algorithms: [{ algorithm: "R' F R U R' U' F' U R" }],
  }),
  oll({
    number: 41, name: "Awkward Fish", aliases: ["别扭鱼", "斑点狗"], family: "扭曲",
    recognition: "扭曲形：顶面两个相邻角朝上；侧面黄色像一条别扭的鱼，头朝右。",
    algorithms: [{ algorithm: "R U R' U R U2 R' F R U R' U' F'" }],
  }),
  oll({
    number: 42, name: "Anti-Awkward Fish", aliases: ["反别扭鱼", "反斑点狗"], family: "扭曲",
    recognition: "扭曲形：顶面两个相邻角朝上；别扭鱼镜像，头朝左。",
    algorithms: [{ algorithm: "R' U' R U' R' U2 R F R U R' U' F'" }],
  }),
  oll({
    number: 43, name: "P", aliases: ["右P"], family: "P形",
    recognition: "小 P 形：顶面只有一个黄色角朝上；侧面黄色构成小 P，开口朝上。",
    algorithms: [
      { algorithm: "F' U' L' U L F" },
      { algorithm: "R' U' F R' F' R U R", note: "R 触发版本" },
    ],
  }),
  oll({
    number: 44, name: "Anti-P", aliases: ["反P", "左P"], family: "P形",
    tags: ["2-Look", "P形", "高频"],
    recognition: "小 P 形：顶面只有一个黄色角朝上；小 P 镜像，开口朝上。",
    algorithms: [{ algorithm: "F U R U' R' F'" }],
  }),
  oll({
    number: 45, name: "Highway", aliases: ["高速", "T形"], family: "T形",
    tags: ["2-Look", "T形", "高频"],
    recognition: "T 形：顶面两个相邻角朝上；侧面一对黄色背对车灯方向，像高速公路。",
    algorithms: [{ algorithm: "F R U R' U' F'" }],
  }),
  oll({
    number: 46, name: "Key", aliases: ["钥匙", "C形"], family: "C形",
    recognition: "C 形：顶面只有一个黄色角朝上；侧面黄色组成 C 字加一个钥匙头。",
    algorithms: [{ algorithm: "R' U' R' F R F' U R" }],
  }),
  oll({
    number: 47, name: "Frying Pan", aliases: ["平底锅", "小L"], family: "小L",
    recognition: "小 L 形：顶面一个黄色棱 + 一个黄色角相邻；侧面黄色像平底锅，柄朝右。",
    algorithms: [
      { algorithm: "R' U' R' F R F' R' F R F' U R" },
      { algorithm: "F' L' U' L U L' U' L U F", note: "左手版本" },
    ],
  }),
  oll({
    number: 48, name: "Anti-Frying Pan", aliases: ["反平底锅", "小L"], family: "小L",
    recognition: "小 L 形：顶面一个黄色棱 + 一个黄色角相邻；平底锅镜像，柄朝左。",
    algorithms: [{ algorithm: "F R U R' U' R U R' U' F'" }],
  }),
  oll({
    number: 49, name: "Right Back Squeezy", aliases: ["右后挤", "小L"], family: "小L",
    recognition: "小 L 形：顶面一个黄色棱 + 一个对角黄色角；侧面黄色挤在右后方。",
    algorithms: [{ algorithm: "r U' r2 U r2 U r2 U' r" }],
  }),
  oll({
    number: 50, name: "Right Front Squeezy", aliases: ["右前挤", "小L"], family: "小L",
    recognition: "小 L 形：顶面一个黄色棱 + 一个对角黄色角；侧面黄色挤在右前方。",
    algorithms: [{ algorithm: "r' U r2 U' r2 U' r2 U r'" }],
  }),
  oll({
    number: 51, name: "Rice Cooker", aliases: ["电饭煲", "I形"], family: "I形",
    recognition: "I 形：顶面两个相对黄色棱；侧面黄色像电饭煲的锅沿，前后对称。",
    algorithms: [
      { algorithm: "F U R U' R' U R U' R' F'" },
      { algorithm: "y2 f R U R' U' R U R' U' f'", note: "宽转版本（先 y2）" },
    ],
  }),
  oll({
    number: 52, name: "Bottle Cap", aliases: ["瓶盖", "I形"], family: "I形",
    recognition: "I 形：顶面两个相对黄色棱；侧面黄色一前一后错开，像瓶盖的锯齿。",
    algorithms: [{ algorithm: "R U R' U R U' B U' B' R'" }],
  }),
  oll({
    number: 53, name: "Streetlights", aliases: ["路灯", "小L"], family: "小L",
    recognition: "小 L 形：顶面一个黄色棱 + 一个黄色角相邻；侧面两黄像一对路灯。",
    algorithms: [
      { algorithm: "l' U2 L U L' U' L U L' U l" },
      { algorithm: "y2 r' U2 R U R' U' R U R' U r", note: "右手版本（先 y2）" },
    ],
  }),
  oll({
    number: 54, name: "Dead Man", aliases: ["僵尸", "小L"], family: "小L",
    recognition: "小 L 形：顶面一个黄色棱 + 一个黄色角相邻；侧面黄色一前一后平躺，像僵尸。",
    algorithms: [{ algorithm: "r U2 R' U' R U R' U' R U' r'" }],
  }),
  oll({
    number: 55, name: "Freeway", aliases: ["高速公路", "I形"], family: "I形",
    recognition: "I 形：顶面两个相对黄色棱；侧面黄色排成一条高速公路。",
    algorithms: [
      { algorithm: "R' F R U R U' R2 F' R2 U' R' U R U R'" },
      { algorithm: "y R U2 R2 U' R U' R' U2 F R F'", note: "短版本（先 y）" },
    ],
  }),
  oll({
    number: 56, name: "Street Lights", aliases: ["红绿灯", "I形"], family: "I形",
    recognition: "I 形：顶面两个相对黄色棱；侧面黄色两组双灯相对，像红绿灯。",
    algorithms: [
      { algorithm: "r' U' r U' R' U R U' R' U R r' U r" },
      { algorithm: "r U r' U R U' R' U R U' R' r U' r'", note: "对称版本" },
    ],
  }),
  oll({
    number: 57, name: "Stealth", aliases: ["隐形", "箭头"], family: "顶角定向",
    recognition: "四个角全部朝上；顶面黄色呈小箭头，侧面只有一对黄色双灯。",
    algorithms: [{ algorithm: "R U R' U' M' U R U' r'" }],
  }),
  // ---------------------------------------------------------------- PLL 21 个
  pll({
    number: 1, slug: "h", name: "H Perm", aliases: ["H置换"], family: "棱置换",
    tags: ["2-Look", "纯棱", "对棱交换"],
    recognition: "四个角都已归位；四条棱两两对换，四个侧面都没有完整三色条。",
    algorithms: [
      { algorithm: "M2 U M2 U2 M2 U M2" },
      { algorithm: "M2 U' M2 U2 M2 U' M2", note: "逆 U 手感" },
    ],
  }),
  pll({
    number: 2, slug: "ua", name: "Ua Perm", aliases: ["U顺", "Ua"], family: "棱置换",
    tags: ["2-Look", "纯棱", "三棱循环"],
    recognition: "四角均归位；找到一条完整三色条放在后面，其余三条棱顺时针循环。",
    algorithms: [
      { algorithm: "M2 U M U2 M' U M2" },
      { algorithm: "R U' R U R U R U' R' U' R2", note: "纯面转版本" },
    ],
  }),
  pll({
    number: 3, slug: "ub", name: "Ub Perm", aliases: ["U逆", "Ub"], family: "棱置换",
    tags: ["2-Look", "纯棱", "三棱循环"],
    recognition: "四角均归位；找到一条完整三色条放在后面，其余三条棱逆时针循环。",
    algorithms: [
      { algorithm: "M2 U' M U2 M' U' M2" },
      { algorithm: "R2 U R U R' U' R' U' R' U R'", note: "纯面转版本" },
    ],
  }),
  pll({
    number: 4, slug: "t", name: "T Perm", aliases: ["T置换"], family: "角棱混合",
    tags: ["2-Look", "相邻角交换", "相邻棱交换", "高频"],
    recognition: "一侧有完整三色条；对面是一组车灯，剩余一对角和一对棱交换。",
    algorithms: [{ algorithm: "R U R' U' R' F R2 U' R' U' R U R' F'" }],
  }),
  pll({
    number: 5, slug: "y", name: "Y Perm", aliases: ["Y置换"], family: "角棱混合",
    tags: ["2-Look", "对角交换", "相邻棱交换"],
    recognition: "没有完整三色条；一组对角角块交换，同时有一对相邻棱交换。",
    algorithms: [{ algorithm: "F R U' R' U' R U R' F' R U R' U' R' F R F'" }],
  }),
  pll({
    number: 6, slug: "aa", name: "Aa Perm", aliases: ["Aa"], family: "角置换",
    tags: ["2-Look", "纯角", "三角循环"],
    recognition: "四条棱均归位；找到同色车灯放在后侧，三个角逆时针循环。",
    algorithms: [{ algorithm: "x R' U R' D2 R U' R' D2 R2 x'" }],
  }),
  pll({
    number: 7, slug: "ab", name: "Ab Perm", aliases: ["Ab"], family: "角置换",
    tags: ["2-Look", "纯角", "三角循环"],
    recognition: "四条棱均归位；找到同色车灯放在后侧，三个角顺时针循环。",
    algorithms: [{ algorithm: "x R2 D2 R U R' D2 R U' R x'" }],
  }),
  pll({
    number: 8, slug: "z", name: "Z Perm", aliases: ["Z置换"], family: "棱置换",
    tags: ["2-Look", "纯棱", "邻棱交换"],
    recognition: "四个角都已归位；相邻棱两两对换，前后或左右出现两条完整三色条。",
    algorithms: [
      { algorithm: "M' U M2 U M2 U M' U2 M2" },
      { algorithm: "U' M2 U M2 U M' U2 M2 U2 M'", note: "M2 起手版本（先 U' 把色条调到左右）" },
    ],
  }),
  pll({
    number: 9, slug: "e", name: "E Perm", aliases: ["E置换"], family: "角置换",
    tags: ["纯角", "对角交换"],
    recognition: "四条棱均归位；四个侧面都是车灯，两组对角角块互换。",
    algorithms: [
      { algorithm: "x' R U' R' D R U R' D' R U R' D R U' R' D' x" },
      { algorithm: "x' L' U L D' L' U' L D L' U' L D' L' U L D x", note: "左手版本" },
    ],
  }),
  pll({
    number: 10, slug: "f", name: "F Perm", aliases: ["F置换"], family: "角棱混合",
    tags: ["相邻角交换", "相邻棱交换"],
    recognition: "一侧有完整三色条；对面车灯错位，一对邻角与一对邻棱交换，节奏比 T 更长。",
    algorithms: [{ algorithm: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R" }],
  }),
  pll({
    number: 11, slug: "ja", name: "Ja Perm", aliases: ["Ja"], family: "角棱混合",
    tags: ["相邻角交换", "相邻棱交换"],
    recognition: "一侧有完整三色条；同侧一对邻角与一对邻棱交换，车灯在左侧。",
    algorithms: [
      { algorithm: "y' R' U L' U2 R U' R' U2 R L" },
      { algorithm: "U2 L' U' L F L' U' L U L F' L2 U L", note: "左手版本（先 U2）" },
    ],
  }),
  pll({
    number: 12, slug: "jb", name: "Jb Perm", aliases: ["Jb"], family: "角棱混合",
    tags: ["相邻角交换", "相邻棱交换", "高频"],
    recognition: "一侧有完整三色条；同侧一对邻角与一对邻棱交换，车灯在右侧。",
    algorithms: [{ algorithm: "R U R' F' R U R' U' R' F R2 U' R'" }],
  }),
  pll({
    number: 13, slug: "ra", name: "Ra Perm", aliases: ["Ra"], family: "角棱混合",
    tags: ["相邻角交换", "相邻棱交换"],
    recognition: "一侧有同色车灯；一对邻角与一对邻棱交换，车灯与色条相邻，方向与 Rb 相反。",
    algorithms: [{ algorithm: "R U' R' U' R U R D R' U' R D' R' U2 R'" }],
  }),
  pll({
    number: 14, slug: "rb", name: "Rb Perm", aliases: ["Rb"], family: "角棱混合",
    tags: ["相邻角交换", "相邻棱交换"],
    recognition: "一侧有同色车灯；一对邻角与一对邻棱交换，车灯与色条相对。",
    algorithms: [{ algorithm: "R2 F R U R U' R' F' R U2 R' U2 R" }],
  }),
  pll({
    number: 15, slug: "na", name: "Na Perm", aliases: ["Na"], family: "角棱混合",
    tags: ["对角交换", "相邻棱交换"],
    recognition: "没有完整三色条；一组对角角块交换，两条棱在车灯之间对换。",
    algorithms: [{ algorithm: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'" }],
  }),
  pll({
    number: 16, slug: "nb", name: "Nb Perm", aliases: ["Nb"], family: "角棱混合",
    tags: ["对角交换", "相邻棱交换"],
    recognition: "没有完整三色条；一组对角角块交换，两条棱在另一侧对换，与 Na 镜像。",
    algorithms: [{ algorithm: "R' U R U' R' F' U' F R U R' F R' F' R U' R" }],
  }),
  pll({
    number: 17, slug: "v", name: "V Perm", aliases: ["V置换"], family: "角棱混合",
    tags: ["对角交换", "相邻棱交换"],
    recognition: "没有完整三色条；一组对角角块交换，一对邻棱交换，整体轮廓像 V。",
    algorithms: [
      { algorithm: "R' U R' U' y R' F' R2 U' R' U R' F R F" },
      { algorithm: "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2", note: "D 层版本" },
    ],
  }),
  pll({
    number: 18, slug: "ga", name: "Ga Perm", aliases: ["Ga"], family: "角棱混合",
    tags: ["G形", "相邻角交换", "三棱循环"],
    recognition: "G 形：一侧有同色车灯，另一侧色条与车灯错一格；一对邻角交换 + 三棱循环。",
    algorithms: [{ algorithm: "R2 U R' U R' U' R U' R2 U' D R' U R D'" }],
  }),
  pll({
    number: 19, slug: "gb", name: "Gb Perm", aliases: ["Gb"], family: "角棱混合",
    tags: ["G形", "相邻角交换", "三棱循环"],
    recognition: "G 形：车灯与色条的错位方向和 Ga 相反；一对邻角交换 + 三棱循环。",
    algorithms: [{ algorithm: "R' U' R U D' R2 U R' U R U' R U' R2 D" }],
  }),
  pll({
    number: 20, slug: "gc", name: "Gc Perm", aliases: ["Gc"], family: "角棱混合",
    tags: ["G形", "相邻角交换", "三棱循环"],
    recognition: "G 形：车灯在右侧的 G 字轮廓；一对邻角交换 + 三棱循环。",
    algorithms: [{ algorithm: "R2 U' R U' R U R' U R2 U D' R U' R' D" }],
  }),
  pll({
    number: 21, slug: "gd", name: "Gd Perm", aliases: ["Gd"], family: "角棱混合",
    tags: ["G形", "相邻角交换", "三棱循环"],
    recognition: "G 形：车灯在左侧的 G 字轮廓；一对邻角交换 + 三棱循环。",
    algorithms: [{ algorithm: "R U R' U' D R2 U' R U' R' U R' U R2 D'" }],
  }),
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
