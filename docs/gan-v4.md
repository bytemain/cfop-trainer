# GAN V4 协议实现说明

本实现针对项目实际设备 `GAN16ui_CB0C`，协议行为参考 csTimer 的公开 GAN adapter，并用本机真机语义探针交叉验证。代码不记录蓝牙地址、MAC 或 manufacturer 原始字节。

公开参考实现：[csTimer `gancube.js`](https://github.com/cs0x7f/cstimer/blob/master/src/js/hardware/gancube.js)。本项目按自身 transport/session/domain 接口重新实现，并用独立 AES fixture 与实际 GAN16 ui 数据验证。

## GATT

| 用途 | UUID |
|---|---|
| Service | `00000010-0000-fff7-fff6-fff5fff4fff0` |
| Notify / Read | `0000fff6-0000-1000-8000-00805f9b34fb` |
| Write | `0000fff5-0000-1000-8000-00805f9b34fb` |

设备广播不包含 service UUID，因此扫描阶段还会以 `GAN16ui` 名称前缀匹配；连接后的特征访问才是最终协议确认。

## 加密

- AES-128 ECB 单块运算，加上 GAN 自定义 IV XOR；
- 基础 key/IV 使用标准 GAN V2/V3/V4 密钥族；
- manufacturer ID 的低字节为 `0x01`；
- 实测九字节 payload 的 offset 3 起连续六字节正向加入 key/IV 前六位，计算使用 `% 255`；
- 20 字节消息先处理前 16 字节，再处理末 16 字节；两个块重叠 12 字节，必须严格保持该顺序；
- 派生材料只存在于会话内存，断开后随 session 释放。

## 请求与响应

| 功能 | 20 字节请求前缀 | 响应 mode |
|---|---|---:|
| 硬件信息 | `df 03` | `f5/f6/fa/fc/fd/fe/ff` |
| 完整状态 | `dd 04 00 ed` | `ed` |
| 电量 | `dd 04 00 ef` | `ef` |
| 历史动作 | `d1 04 ...` | `d1` |

`01` 是实时 move，包含设备时间戳、16-bit move counter、转轴和方向。`ed` 用 corner/edge permutation + orientation 表示完整状态；解析后先做 cubie 合法性校验，再转换成 54 字符 `URFDLB` facelet 串。

## 姿态分量与坐标方向

`ec` gyro packet 的协议字段顺序为 `qw, qx, qy, qz`，但不能把字段名直接作为应用语义分量。CubeStation Android bridge 和 GAN16 ui 受控整机旋转采样共同确认，应用四元数必须重排为：

```text
app.x = protocol qy
app.y = protocol qx
app.z = protocol qz
app.w = protocol qw
```

重排后的四元数按 `cube body -> GAN world` 使用。相对机体旋转为：

```text
inverse(previous) * current
```

一组红色中心持续朝向用户、整颗魔方绕红—橙轴旋转的脱敏真机 fixture 得到 X 主导相对轴，已固化在 `orientation.test.ts`。如果省略 X/Y 重排，同一动作会错误显示为 Y 主导，这也是早期 3D 视图轴错位的根因。

GAN16 ui 当前固件的独立 4-bit angular velocity 在受控采样中可能持续为零，因此动态轴识别不得只依赖 velocity；实现会回退到连续四元数差分。原始四元数时间序列只在信号实验室内存窗口中使用，不写入 JSONL。

## 可靠性策略

应用以完整 snapshot 的 counter 建立基线。实时 move counter 必须连续；发现 gap 时：

1. 当前训练标记为 desync，不计入可信成绩；
2. 停止计时并进入 degraded；
3. 主动请求新的完整 snapshot；
4. cubie 校验通过后恢复实时镜像，但本次训练保持无效语义。

历史动作请求和解析已保留为下一阶段能力；当前正式恢复路径以完整 snapshot 为准，避免在尚未完成高压丢包 fixture 前错误拼接历史动作。

## 已验证真机结果

- GATT：GAN V4；
- 硬件：1.0；
- 软件：2.4；
- 电量响应：78%；
- snapshot counter：147，cubie 校验通过；
- move counter：148–170 连续，成功解析顺/逆时针动作；
- macOS 断开成功；
- desktop executable、Android aarch64 debug APK、iOS arm64 simulator app 均可构建。

真机验证数字仅用于兼容性说明，不包含设备地址或加密派生字节。
