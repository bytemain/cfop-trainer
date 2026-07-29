# CFOP Trainer

面向 GAN 智能魔方的跨平台 CFOP 训练 App 骨架，使用 Tauri 2、Svelte 5、TypeScript、XState 和 SQLite。

当前已包含：

- Desktop、Android、iOS 工程；
- `tauri-plugin-blec` BLE transport adapter；
- GAN V1/V2/V3/V4 protocol adapter 接口；
- 已经 GAN16 ui 真机验证的 GAN V4 AES-128 decoder、snapshot、电量和 move counter；
- 可测试的 3x3 facelet reducer 和阶段事实；
- XState 训练流程；
- SQLite migration；
- Material 3 Adaptive 风格的手机/桌面响应式训练界面；
- 演示连接、逐步打乱、自动计时、逐步还原和 desync/resync 交互；
- 3D 魔方视图带层转动动画（支持面转 / 宽转 / M-E-S 层转 / x-y-z 整转）；
- 57 OLL + 21 PLL + 41 F2L 全集 Case 库：3D 图示（列表缩略图与详情均为 WebGL 渲染），图案由公式逆运算推导，每条公式都经“能还原自己 case”校验，可逐步播放；Cross 是搜索型训练（内置最优解求解器给出提示），不以 case 表形式提供。
- 打乱流程带前置闸门与容错：连接设备后需先还原魔方、白上绿前放置（姿态可校验时）才能生成打乱；打乱中做错会被检测（提示应为哪步、实际做了哪步），直接做上一步的逆动作即可回退，回到正确状态后自动继续。
- 实时数据流全保真落盘（`cfop-trainer-stream.jsonl`，10 MiB × 5 滚动）：解密协议帧 / 姿态 / 动作，供离线分析，见 [docs/testing.md](./docs/testing.md)。

Case 图案与复盘识别共用同一份推导数据：`src/lib/cases/caseLibrary.ts` 声明公式，`CubeState` 与 pattern 在模块初始化时由逆公式作用于标准态得出，单测保证每个公式都能还原其对应 Case。

2026-07-10 已用 `GAN16ui_CB0C` 完成 GAN V4 GATT、密钥派生、完整状态、电量和连续转动事件的真机验证。兼容性进度见 [docs/device-compatibility.md](./docs/device-compatibility.md)，协议说明见 [docs/gan-v4.md](./docs/gan-v4.md)。

由于 `tauri-plugin-blec 0.12` 的 Android 原生实现要求 API 26，当前 Android 最低版本为 Android 8.0。

## 开发

```bash
npm install
npm run dev
npm run check
npm test
npm run test:e2e
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

桌面：

```bash
npm run tauri dev
```

Android/iOS 工程已经初始化：

```bash
npm run tauri android dev
npm run tauri ios dev
npm run build:ios:sim
```

扫描附近 BLE 广播并标记 GAN 候选设备：

```bash
cargo run --manifest-path src-tauri/Cargo.toml --example ble_scan
cargo run --manifest-path src-tauri/Cargo.toml --example gan_probe
cargo run --manifest-path src-tauri/Cargo.toml --example gan_v4_live
```

诊断工具不输出或保存设备地址、MAC 和 manufacturer 原始字节。`gan_v4_live` 只输出语义结果；可选 snapshot fixture 是解密后的魔方状态，不包含设备身份材料。

完整产品和技术约束见 [PRD.md](./PRD.md)。

测试分层、Playwright、Tauri 原生自动化边界和三端 JSONL 日志说明见 [docs/testing.md](./docs/testing.md)。
