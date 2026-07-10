# 智能魔方兼容矩阵

> 该表只记录实际扫描或真机测试结果。广播发现不等于协议兼容。

| 设备 | 广播名 | RSSI | Manufacturer ID | 固件 | 协议 | macOS | Android | iOS | Windows | 状态 |
|---|---|---:|---:|---|---|---|---|---|---|---|
| GAN16 ui | `GAN16ui_CB0C` | -39 dBm | 1 | 待读取 | 待连接判定 | 广播发现通过 | 待测 | 待测 | 待测 | 已发现，待 GATT/解密验证 |

## 下一步验证

1. 连接并枚举 GATT service/characteristic；
2. 读取固件、系统 ID 和电量；
3. 判定 GAN 协议版本和密钥派生方式；
4. 读取完整 snapshot；
5. 记录六面正反转动 fixture；
6. 快速连续 100 步并验证 counter/gap；
7. 断开、重连和 snapshot 恢复；
8. 分别在 macOS、Android、iOS、Windows 真机复测。

扫描结果不保存蓝牙地址，只记录产品广播名、信号强度和非唯一 manufacturer ID。
