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

## 原生 Tauri 自动化

下一阶段接入 WebdriverIO Tauri service 时，应只在 debug/test profile 注册 embedded WebDriver 与 backend-access plugin，release 构建不得包含自动化入口。原生套件至少覆盖：

1. App binary 启动和主窗口；
2. BLE 权限状态；
3. scan IPC 与候选设备卡片；
4. connect / subscribe / snapshot；
5. JSONL 前后端日志抓取；
6. disconnect / reconnect / desync recovery。
