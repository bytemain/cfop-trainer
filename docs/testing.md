# 测试与自动化基建

项目使用分层测试，避免把浏览器 UI 通过误认为原生 BLE 或 Tauri IPC 已通过。

## 测试层次

| 层 | 工具 | 覆盖范围 |
|---|---|---|
| Domain / protocol | Vitest | cube reducer、GAN AES、packet parser、mock BLE session |
| Web UI E2E | Playwright | 桌面/手机响应式、导航、演示训练、对比度、溢出 |
| macOS real BLE | Rust `gan_v4_live` | CoreBluetooth、GATT、AES、snapshot、电量、move counter |
| Tauri native E2E | WebdriverIO Tauri service（下一阶段） | 原生窗口、IPC、前后端日志、真实 binary |

Tauri 官方当前推荐 `@wdio/tauri-service` 做原生 WebDriver 自动化。macOS 通过 debug-only embedded WebDriver plugin 支持；直接使用 `tauri-driver` 仍只支持 Windows/Linux。Playwright 继续作为速度更快、反馈更稳定的 renderer/UI 测试层。

## Playwright

安装浏览器：

```bash
npx playwright install chromium
```

运行全部桌面和手机测试：

```bash
npm run test:e2e
```

调试：

```bash
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:report
```

失败时保留 screenshot；首次重试保留 trace；失败录像会写入 `test-results/playwright`。HTML 报告写入 `playwright-report`。

## JSONL 日志

desktop、Android、iOS 都通过 Tauri command 写同一 schema 的 JSONL。日志目录使用系统 `app_log_dir`，主文件为 `cfop-trainer.jsonl`：

- 单文件最多 5 MiB；
- 保留 3 个滚动文件；
- 单行最多 16 KiB；
- 每行必须是 JSON object；
- 地址、MAC、device ID、manufacturer 原始数据、key/IV、packet/payload 字段会被拦截；
- 前端内存保留最近 500 条，供自动化和后续诊断导出使用。

macOS 当前路径：

```text
~/Library/Logs/com.cubestation.cfoptrainer/cfop-trainer.jsonl
```

## 实时数据流记录（全保真）

`cfop-trainer-stream.jsonl`（同目录）是与脱敏日志分离的全保真通道，供离线分析实时数据流：

- 单文件最多 10 MiB；滚动保留 4 个（加活动文件共 5 个、总计 50 MiB）；
- 单行最多 64 KiB；每行必须是 JSON object；
- 行格式：`{ "schemaVersion": 1, "unixMs": …, "monoMs": …, "topic": …, "data": {…} }`；
- topic：`frame`（每个解密后 BLE 通知帧的 hex，可用 `parseGanV4Packet` 重放；含无效帧）、`pose`（每个姿态观测 + 健康门裁决）、`move`（域动作事件）、`session` / `calibration`（连接、断开、锚点、快校生命周期）；
- 前端按 500 ms 或 256 行批量刷盘，溢出 4096 行时丢弃最旧行；
- 隐私边界：只记录协议通知载荷与派生事件，绝不记录设备地址、设备名、manufacturer 数据与密钥材料（通知帧为加密后的协议数据，本身不含身份）。

macOS 当前路径：

```text
~/Library/Logs/com.cubestation.cfoptrainer/cfop-trainer-stream.jsonl
```

## 原生 Tauri 自动化

下一阶段接入 WebdriverIO Tauri service 时，应只在 debug/test profile 注册 embedded WebDriver 与 backend-access plugin，release 构建不得包含自动化入口。原生套件至少覆盖：

1. App binary 启动和主窗口；
2. BLE 权限状态；
3. scan IPC 与候选设备卡片；
4. connect / subscribe / snapshot；
5. JSONL 前后端日志抓取；
6. disconnect / reconnect / desync recovery。
