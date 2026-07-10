# 智能魔方兼容矩阵

> 该表只记录实际扫描或真机测试结果。广播发现不等于协议兼容。

| 设备 | 广播名 | RSSI | Manufacturer ID | 固件 | 协议 | macOS | Android | iOS | Windows | 状态 |
|---|---|---:|---:|---|---|---|---|---|---|---|
| GAN16 ui | `GAN16ui_CB0C` | -39 dBm | 1 | HW 1.0 / SW 2.4 | GAN V4 | GATT、AES、snapshot、电量、连续 move 通过 | 工程构建通过，BLE 真机待测 | 工程构建通过，BLE 真机待测 | 待测 | macOS 核心协议通过 |

## 下一步验证

已完成：

1. 枚举 GATT 并确认 GAN V4 service/read/write characteristic；
2. 读取硬件 1.0、软件 2.4、电量 78%；
3. 确认 manufacturer payload 的后 6 字节正向参与标准 GAN V2/V4 AES 派生；
4. 读取并通过 cubie 校验的完整 snapshot；
5. 连续解析 counter 148–170 的真实转动事件，动作方向与计数连续；
6. 断开流程通过。

仍需完成：

1. 六面正反转动的命名对照 fixture；
2. 快速连续 100 步、主动制造丢包并验证 snapshot 恢复；
3. 重连与系统蓝牙切换恢复；
4. Android、iOS 和 Windows BLE 真机复测。

扫描结果不保存蓝牙地址，只记录产品广播名、信号强度和非唯一 manufacturer ID。
