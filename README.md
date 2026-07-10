# CFOP Trainer

面向 GAN 智能魔方的跨平台 CFOP 训练 App 骨架，使用 Tauri 2、Svelte 5、TypeScript、XState 和 SQLite。

当前已包含：

- Desktop、Android、iOS 工程；
- `tauri-plugin-blec` BLE transport adapter；
- GAN V1/V2/V3/V4 protocol adapter 接口；
- 可测试的 3x3 facelet reducer 和阶段事实；
- XState 训练流程；
- SQLite migration；
- Material 3 Adaptive 风格的手机/桌面响应式训练界面；
- 演示连接、逐步打乱、自动计时、逐步还原和 desync/resync 交互。

真实 GAN 协议解密尚未实现，必须基于项目实际拥有的型号和录制 fixture 完成 BLE 技术闸门。

2026-07-10 本机扫描已发现 `GAN16ui_CB0C`，确认当前测试设备为 GAN16 ui。兼容性进度见 [docs/device-compatibility.md](./docs/device-compatibility.md)。

由于 `tauri-plugin-blec 0.12` 的 Android 原生实现要求 API 26，当前 Android 最低版本为 Android 8.0。

## 开发

```bash
npm install
npm run dev
npm run check
npm test
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
```

扫描附近 BLE 广播并标记 GAN 候选设备：

```bash
cargo run --manifest-path src-tauri/Cargo.toml --example ble_scan
```

诊断工具只输出广播名、RSSI、服务 UUID 和 manufacturer ID，不保存设备地址。

完整产品和技术约束见 [PRD.md](./PRD.md)。
