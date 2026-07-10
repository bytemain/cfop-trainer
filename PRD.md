# CFOP 智能魔方训练 App — 产品需求文档

> 文档状态：v0.2（已消歧，可进入技术验证）  
> 更新日期：2026-07-10  
> 产品代号：CFOP Trainer  
> 目标读者：项目 owner、产品/设计、开发、测试

---

## 1. 产品定义

CFOP Trainer 是一款面向 3x3 CFOP 学习者和进阶玩家的本地优先训练 App。App 通过 Bluetooth Low Energy（BLE）连接经过兼容性验证的 GAN 智能魔方，持续接收动作和魔方状态，为用户提供：

- 全流程 CFOP 自动计时与阶段分段；
- Cross、F2L、OLL、PLL 分项训练；
- OLL/PLL Case 定向练习；
- 当前阶段与 Case 识别；
- 训练历史、弱项和稳定性统计；
- 在手机、平板和电脑窗口中自适应的训练界面。

核心价值不是“带蓝牙的计时器”，而是：

> 利用真实魔方状态，把一次还原拆解成可观察、可复盘、可定向训练的过程。

### 1.1 核心差异化

1. 按真实状态自动计算 Cross/F2L/OLL/PLL split；
2. 根据状态识别 Case，而不只展示贴纸；
3. 为指定 Case 生成 setup，引导用户准备物理魔方；
4. 对 BLE 丢步、断连和状态漂移提供恢复能力；
5. 根据历史事件计算阶段弱项，而不只记录总成绩。

---

## 2. 平台与发布策略

“手机版”和“电脑版”是产品硬性目标，不再作为 v2 的后续设想。移动端和桌面端必须从项目初始化阶段共享领域模型、BLE 抽象、数据库 schema 和自适应设计体系。

| 平台 | 目标 | v1 策略 |
|---|---|---|
| Android | 正式支持 | 最低 API 26（Android 8），Android 12+ 优先验证 |
| iOS | 正式支持 | v1 必须进入架构和真机验证，可晚于首批上架 |
| Windows | 正式支持 | 至少一个首发桌面平台 |
| macOS | 正式支持 | 至少一个首发桌面平台 |
| Linux | 实验性 | 不作为 v1 发布阻塞项 |

首发推荐选择“一个手机平台 + 一个桌面平台”跑通完整闭环，再扩展其他平台。没有进入真机兼容矩阵的平台和设备，不得对外宣称正式支持。

### 2.1 前后台约束

- v1 训练要求 App 保持前台；
- 训练中默认保持屏幕常亮；
- v1 不承诺锁屏或切后台后继续接收动作；
- 横竖屏或窗口 resize 不能丢失当前 session；
- 手机、平板和桌面使用统一 breakpoint。

---

## 3. 用户与核心旅程

### 3.1 目标用户

- 已掌握基础 CFOP、希望稳定 sub-30 的玩家；
- 希望系统训练 F2L/OLL/PLL、向 sub-20 进阶的玩家；
- 从 LBL 转向 CFOP，需要 Case 库和动作反馈的学习者。

### 3.2 非目标用户

- 只需要比赛计时器的用户；
- 需要在线排行榜、社交或云同步的用户；
- 非 3x3 魔方用户；
- v1 兼容矩阵外的品牌和型号；
- 顶级选手需要的赛事级动作捕捉和心理训练。

### 3.3 核心旅程

1. 首次打开并完成蓝牙授权；
2. 扫描兼容设备；
3. 连接后读取设备信息和完整状态；
4. 状态同步完成后允许训练；
5. 选择全流程或 Case Drill；
6. App 引导物理打乱并实时验证；
7. 用户还原，App 记录动作、阶段和时间；
8. 结束后回放事件流，计算稳定 final split；
9. 保存结果，并从历史发起下一轮弱项训练。

---

## 4. 范围

### 4.1 MVP 必须完成

1. 一个手机平台和一个桌面平台跑通训练闭环；
2. 支持至少 1～2 个实际拥有并通过测试的 GAN 型号；
3. BLE 扫描、连接、协议识别、初始状态、动作接收和重连；
4. 丢步检测、完整状态重同步和结果可信度标记；
5. 2D 魔方视图；
6. 引导打乱；
7. 第一有效动作开始计时，solved 自动停止；
8. Cross/F2L/OLL/PLL 自动 split；
9. OLL/PLL Case Drill；
10. 基础历史、PB、平均成绩和弱项列表；
11. Compact/Medium/Expanded 自适应 UI；
12. 深色、浅色和跟随系统主题。

### 4.2 条件纳入 MVP

- 3D 魔方实时视图；
- Cross/F2L 独立训练；
- 识别训练题库；
- 简单算法候选提示。

### 4.3 延后到 v1.1+

- GAN 蓝牙 Timer 双设备连接；
- 自由还原中的实时唯一算法识别；
- F2L 高级 200+ 算法；
- Look-ahead 停顿评估；
- 用户自定义算法；
- 偏离后的双路径动态求解；
- 3D 动作箭头；
- color-neutral；
- JSON/CSV 导出；
- Linux 正式支持；
- 云同步、账户和社交。

---

## 5. 智能魔方与 BLE

### 5.1 支持边界

v1 只支持兼容矩阵中明确列出的 GAN 智能魔方，不能使用“GAN 全系”作为验收标准，也不能只依赖广播名判断协议。

兼容矩阵必须记录：

| 字段 | 含义 |
|---|---|
| 品牌/型号 | 完整设备名称 |
| 固件版本 | 测试通过版本 |
| 协议 | GAN V1/V2/V3/V4 |
| 平台 | Android/iOS/Windows/macOS/Linux |
| 扫描/连接 | 是否稳定 |
| 完整状态 | 是否可读取 |
| 实时动作 | 是否连续、是否带 counter |
| 电量/版本 | 是否可读取 |
| 重连 | 是否能恢复完整状态 |
| 已知问题 | 机型、系统或固件限制 |

广播名 `MG` 不属于 GAN v1 范围，不能作为默认过滤条件。

### 5.2 智能魔方与 GAN Timer

智能魔方和 GAN 蓝牙 Timer 是两个独立 peripheral：

- 智能魔方提供动作、状态、电量和部分型号的姿态；
- Timer 提供放手开始、计时更新和停止结果。

MVP 不依赖 Timer。默认计时语义：

- 引导打乱完成后进入 ready；
- 第一有效转动开始计时；
- 达到 solved 状态后停止；
- 桌面空格键可作为辅助操作；
- 手动停止需记录 timing source，不能冒充自动成绩。

### 5.3 连接状态

```ts
type CubeConnectionState =
  | 'bluetooth-unavailable'
  | 'permission-required'
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'discovering-services'
  | 'authenticating'
  | 'synchronizing'
  | 'ready'
  | 'degraded'
  | 'reconnecting'
  | 'disconnected'
  | 'unsupported';
```

只有 `ready` 允许开始可信训练。`degraded` 表示仍可操作，但部分指标可能不准确。

### 5.4 分层

业务层不直接依赖 Web Bluetooth。采用：

```text
BleTransport
  └─ TauriBlecTransport

GanProtocolAdapter
  ├─ GanV1Protocol
  ├─ GanV2Protocol
  ├─ GanV3Protocol
  └─ GanV4Protocol
```

BLE transport 负责扫描、连接、读写、订阅；GAN adapter 负责服务识别、解密、move counter、完整 snapshot、电量和协议错误。

### 5.5 动作事件与恢复

识别引擎输入为结构化事件，不能假设一次 BLE 通知只包含一步：

```ts
interface CubeMoveEvent {
  move: string;
  sequence: number;
  cubeTimestamp?: number;
  receivedAt: number;
  protocol: string;
}
```

以下情况必须请求完整 snapshot：

- sequence 不连续；
- move counter 超出协议可回放范围；
- 解密或 packet 校验失败；
- 本地状态与设备状态不一致；
- 断线重连完成。

同步异常记为 transport/desync，不记为用户训练错误。

---

## 6. 魔方、阶段与识别

### 6.1 Cross 与朝向

- MVP 默认白 Cross，并允许用户选择一个固定 Cross 颜色；
- color-neutral 延后；
- 训练前要求标准朝向校准；
- Case 分类对 AUF 和允许的 `y` 旋转做 canonicalization；
- 只有经过型号验证的陀螺仪数据才能用于整 cube 朝向追踪。

### 6.2 阶段事实

阶段不是不可逆单向状态机。每一步都从当前状态推导：

```ts
interface PhaseFacts {
  crossSolved: boolean;
  solvedF2lSlots: number;
  f2lSolved: boolean;
  ollSolved: boolean;
  pllSolved: boolean;
  cubeSolved: boolean;
}
```

用户破坏已完成结构时，阶段可以回退。

### 6.3 Split

- 实时显示 provisional split；
- session 结束后回放事件流计算 final split；
- final split 使用最后一次稳定完成各阶段的边界；
- 无法恢复的丢步使 session `is_valid = false`，不进入 PB；
- 时间源优先使用 cube timestamp，其次使用 App receive timestamp；
- session 必须记录 timing source。

### 6.4 识别等级

1. 阶段识别：由状态事实确定；
2. Case 识别：由 canonical state signature 分类；
3. 算法识别：引导模式按目标 sequence 显示精确进度；自由还原只返回候选和置信度，不承诺实时唯一结果。

算法匹配不得使用字符级模糊相似度。动作必须 parse 成结构化 move，并结合前置 Case、正规化 sequence 和结束状态判断。

### 6.5 F2L 当前 pair

系统可以可靠显示已完成 slot 和刚完成的 slot；“用户当前意图做哪一对”只能作为带置信度的候选，置信度不足时不显示确定性结论。

---

## 7. 训练模式

### 7.1 全流程 CFOP

1. 生成 random-state 3x3 scramble；
2. 用户逐步执行，App 验证结构化 move；
3. 到达目标状态并同步后进入 ready；
4. 第一 move 开始计时；
5. 记录 move、阶段事实和 provisional split；
6. solved 后自动停止；
7. 回放事件流并生成 final split；
8. 保存设备、协议、数据版本和可信度。

打乱不承诺固定 20 步。random-state scramble 通常约 18～25 步。

### 7.2 分项训练

| 模式 | 初始约束 | 完成条件 | MVP |
|---|---|---|---|
| Cross | 指定 Cross 被定向打乱 | Cross solved | 条件纳入 |
| F2L | Cross 保持完成 | 4 slots solved | 条件纳入 |
| OLL | F2L 完成 | 顶层定向完成 | 必须 |
| PLL | OLL 完成 | 最终 solved，允许 AUF | 必须 |

### 7.3 Case Drill

Case 与 Algorithm 是多对多关系。Case 存 canonical pattern；算法不是 Case 的唯一来源。

流程：选择 Case → 生成/选择 setup → 引导物理执行 → 校验状态 → 第一 move 开始 → 达成目标后记录结果。

MVP 偏离处理：显示期望和实际 move；做错误 move 的逆可恢复；提供重新开始和恢复初始状态；不做任意偏离后的双路径动态求解。

### 7.4 样例回放

正式训练要求物理魔方，但 App 提供只读 fixture 回放，用于首次体验、UI 演示、自动测试和无真机开发。回放不能生成正式成绩。

---

## 8. Case 和算法数据

MVP 数据范围：OLL 57、PLL 21、2-look 标签；F2L 基础 Case 条件纳入，高级 F2L 延后。

Case 存 canonical pattern 和算法 ID 列表；Algorithm 存 case ID、moves、setup、标签和来源。变体必须通过 cube transformation 作用于 pattern 和 move，按 canonical hash 去重。禁止字符串替换实现 mirror/rotation；`U2'` 必须正规化为 `U2`。

所有内置数据必须记录来源、license、attribution、是否允许修改/再分发、数据版本和校验状态。“社区公开”不等于可随 App 打包。

---

## 9. 数据持久化

使用 `tauri-plugin-sql + SQLite`，不同时引入 `better-sqlite3`。数据库包含：

- `cube_device`：平台设备 ID、型号、固件和协议；
- `training_session`：模式、打乱、Cross 色、split、时间源、版本、desync 和有效性；
- `session_event`：递增 sequence、cube timestamp、receive timestamp、事件类型和 payload；
- migration、外键和查询索引。

MVP 统计：总训练次数/时长、各模式 PB、Ao5/Ao12、阶段平均 split、Case 成功率/平均用时、无效 session 和弱项排名。

---

## 10. UI 设计体系

采用 Material Design 3 Adaptive 作为 breakpoint、导航、触控目标、sheet/menu/dialog 和无障碍规范。组件实现可使用 Bits UI/shadcn-svelte，但项目必须维护自己的 design tokens 和业务组件。

| Breakpoint | 宽度 | 布局 |
|---|---:|---|
| Compact | `< 600px` | 手机单栏、底部导航、详情 bottom sheet |
| Medium | `600～839px` | 单栏或低密度双栏、navigation rail |
| Expanded | `840～1199px` | 推荐双栏 |
| Large | `1200～1599px` | 双栏、展开 navigation rail |
| Extra large | `≥ 1600px` | 最多三栏 |

一级入口：训练、Case、历史、设置。信息优先级：连接与同步 → 魔方 → 计时 → 训练目标 → 动作引导 → 阶段/Case → split → 详细指标。

移动端要求单栏、安全区、底部导航、最小 48px 触控目标、不依赖 hover。桌面使用 navigation rail、双栏分析和键盘快捷键，窗口变窄时切换布局而非压缩宽屏 UI。

魔方贴纸色与语义状态色完全分离。状态反馈必须同时使用图标/文字/形状。计时器使用 tabular numbers，公式使用等宽字体，并支持 `prefers-reduced-motion`。

---

## 11. 技术架构

| 层 | 选型 |
|---|---|
| Shell | Tauri 2，desktop/Android/iOS 从 M0 纳入 |
| UI | Svelte 5 + TypeScript |
| Design | Material 3 Adaptive tokens |
| State machine | XState；Svelte store 管理 UI 派生状态 |
| BLE | `tauri-plugin-blec` 起步，通过自有 transport 隔离 |
| GAN | V1/V2/V3/V4 独立 adapter |
| Cube core | TypeScript domain core，评估 cubing.js |
| 3D | cubing.js Twisty 或 Three.js，先验证移动 WebGL |
| 2D | SVG |
| DB | `tauri-plugin-sql + SQLite` |
| Test | Vitest、Cargo test、fixture replay、真机集成测试 |

模块边界：

```text
src/lib/
├── ble/                 # transport 与 Tauri adapter
├── protocols/gan/       # GAN 协议 adapter
├── cube/                # move、state、phase facts
├── sessions/            # XState、split、validation
├── data/                # repository、schema
├── stores/              # Svelte 响应式状态
└── components/          # 自适应业务 UI
```

---

## 12. BLE 技术闸门与验收

进入完整功能开发前，目标平台和型号必须完成：授权、扫描、连接、服务发现、协议识别/解密、初始 snapshot、六面正反转动、快速连续 100 步、断线重连、重连恢复、20 分钟连续训练和前后台边界测试。

任一首发平台不能通过闸门时，停止扩展产品功能并重新评估 BLE 路线。

自动测试至少覆盖：move parser、move + inverse、四次转动、scramble target、phase facts、sequence gap、resync、session replay、无效成绩不进 PB 和 breakpoint 核心 UI。

---

## 13. 里程碑

| 阶段 | 周期 | 交付 |
|---|---:|---|
| M0 产品与平台冻结 | 0.5～1 周 | 平台/设备矩阵、design tokens、工程初始化 |
| M1 BLE 技术闸门 | 1～2 周 | 手机 + 桌面真机 BLE 闭环 |
| M2 魔方核心与回放 | 1～1.5 周 | reducer、snapshot、gap/resync、fixture |
| M3 自适应 Shell | 1～1.5 周 | 三档布局、连接引导、2D 魔方 |
| M4 打乱与完整计时 | 1.5～2 周 | random-state scramble、自动计时、final split |
| M5 OLL/PLL Drill | 1.5～2 周 | Case、setup、校验和结果 |
| M6 数据与统计 | 1 周 | SQLite、历史、PB、平均和弱项 |
| M7 3D 与体验完善 | 1～1.5 周 | 3D、主题、错误恢复、移动体验 |
| M8 稳定与发布 | 2 周 | 真机回归、签名、安装包、发布说明 |

预期：技术纵切 3～5 周；可用 MVP 8～12 周；手机 + 电脑 Beta 10～14 周；原 v0.1 大部分完整范围 16～24 周。

---

## 14. 已确认的默认决策

1. Case Drill 是核心功能；
2. 手机版和电脑版从 v1 架构开始支持；
3. 训练要求物理魔方，但提供只读样例回放；
4. 默认第一步开始、solved 停止；
5. GAN Timer 是独立配件，MVP 不依赖；
6. 自由还原算法识别只返回候选和置信度；
7. MVP 默认白 Cross，并允许配置一个固定 Cross 颜色；
8. v1 不做 color-neutral；
9. v1 训练要求前台并保持屏幕常亮；
10. 许可证不清晰的数据不进入发布包；
11. desync 与用户训练错误严格区分；
12. Material Design 3 Adaptive 是 UI/UX 基础；
13. BLE 真机技术闸门优先于全部产品功能。

## 15. Owner 仍需填写

- 首发手机平台：Android / iOS；
- 首发桌面平台：Windows / macOS；
- 当前拥有的设备已扫描确认为 `GAN16ui_CB0C`（GAN16 ui）；固件和协议版本仍需连接后读取；
- 是否有独立 GAN Timer；
- 首发是否必须上架 App Store / Google Play；
- 产品名称、图标和品牌主色；
- 首批算法数据的许可证来源。

在这些信息补齐前，代码中的 GAN adapter 只能使用 mock/fixture 和明确标注的实验实现，不能宣称已完成真实设备兼容。
