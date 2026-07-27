# GAN V4 协议实现说明

本实现针对项目实际设备 `GAN16ui_CB0C`，协议行为参考 csTimer 的公开 GAN adapter，并用本机真机语义探针交叉验证。代码不记录蓝牙地址、MAC 或 manufacturer 原始字节。

公开参考实现：[csTimer `gancube.js`](https://github.com/cs0x7f/cstimer/blob/master/src/js/hardware/gancube.js)。本项目按自身 transport/session/domain 接口重新实现，并用独立 AES fixture 与实际 GAN16 ui 数据验证。

csTimer 当前实现能逐 bit 交叉验证 `01`（实时动作）、`ed`（完整状态）、`d1`（历史动作）和 `ef`（电量），但它的 V4 `0xec` 分支只有 `// gyro` 注释，没有解析四元数。因此 csTimer 不是姿态轴正反的证据来源；`0xec` 的字段边界来自 CubeStation APK 内置的 GAN SDK `ProtocolV3` 官方规则，分量语义再由其 Android bridge 验证。

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
| 写入完整复原状态 | `d2 0d 05 39 77 00 00 01 23 45 67 89 ab ...` | `d2`，随后用 `ed` 回读校验 |

`01` 是实时 move，包含设备时间戳、16-bit move counter、转轴和方向。`ed` 用 corner/edge permutation + orientation 表示完整状态；解析后先做 cubie 合法性校验，再转换成 54 字符 `URFDLB` facelet 串。

CubeStation 的“读取同步”和“复原设备状态”是两个不同操作。`appProtoId=2` 仅发送 `dd 04 00 ed` 读取固件内部状态；`appProtoId=6` 使用 `d2 0d` 加 100-bit 完整 cubie state 写入设备。复原 payload 依次为 8×3-bit 角块排列 `0…7`、8×2-bit 零方向、12×4-bit 棱块排列 `0…11`、12×1-bit 零方向。应用只在用户明确确认实体已经复原时发送该写命令，随后必须重新请求 `ed` 并验证为 solved，不能只修改前端画面。

## 姿态分量与坐标方向

CubeStation 的官方规则把解密后的 `ec` gyro packet 定义为：

| bit 范围 | 字节 | CubeStation 字段 | 编码 | 应用语义 |
|---:|---:|---|---|---|
| 0–7 | 0 | `bleProtoId` | `0xec` | mode |
| 8–15 | 1 | `dataLength` | unsigned 8-bit | length |
| 16–31 | 2–3 | `dataFour1[0]` | 1-bit sign + 15-bit magnitude | `w` |
| 32–47 | 4–5 | `dataFour1[1]` | 1-bit sign + 15-bit magnitude | `y` |
| 48–63 | 6–7 | `dataFour1[2]` | 1-bit sign + 15-bit magnitude | `x` |
| 64–79 | 8–9 | `dataFour1[3]` | 1-bit sign + 15-bit magnitude | `z` |
| 80–83 | byte 10 高半字节 | `angleSpeed1[0]` | 1-bit sign + 3-bit magnitude | velocity x |
| 84–87 | byte 10 低半字节 | `angleSpeed1[1]` | 1-bit sign + 3-bit magnitude | velocity y |
| 88–91 | byte 11 高半字节 | `angleSpeed1[2]` | 1-bit sign + 3-bit magnitude | velocity z |

符号位 `0` 为正、`1` 为负。CubeStation 的 `Quaternion(float,float,float,float)` 构造器按 `(x,y,z,w)` 存储，而 bridge 明确调用 `Quaternion(array[2], array[1], array[3], array[0])`。因此应用四元数必须重排为：

```text
app.x = protocol qy
app.y = protocol qx
app.z = protocol qz
app.w = protocol qw
```

重排后的四元数按 GAN V4 传感器姿态使用。协议验收与渲染必须共享同一个相对顺序，不能分别通过交换乘法或翻转 UI 轴相互补偿。

GAN16 ui 的传感器安装方向是型号/协议级固定契约，不是用户标定项。运行时 canonical cube space 使用：

```text
bodyToModel =
[ 0 -1  0 ]
[ 0  0 -1 ]
[ 1  0  0 ]

relativeOrder = reference * inverse(current)

identitySensorPose = (x -0.07567134, y 0.01883056, z 0.84577431, w -0.52781159)
```

`identitySensorPose` 是白上绿前标准握持下的传感器读数（与 `orientation.test.ts` 同源的真机 fixture）。没有会话锚点时它充当 reference，使固定契约直接给出绝对姿态：白上绿前渲染为单位姿态，任意握持连接都有 `P_ref · (P_ref⁻¹ · P_cur) = P_cur` 的严格绝对跟踪。GAN 四元数是被动变换（world→body），`Rdelta` 是物体坐标系增量，合成显示姿态时须右乘参考姿态：`Rdisplayed = Rreference · Rdelta`；左乘会把每个转动共轭一遍参考姿态。注意 180° fixture 无法区分乘法顺序，方向证据必须来自受控的非 180° 转动。

应用连接 GAN V4 时必须覆盖历史本地 axis calibration，不能要求普通用户重复三轴采集。首个姿态帧经固定契约转换成绝对 `CubePose` 后建立 session anchor；anchor 只负责掉线/传感器重启后的连续性，不得把首帧强制归零成 identity。

旧版本曾允许用 `invertX/Y/Z` 与三个 Euler offset 补偿协议模型。这些值如果继续保存在本地，会在固定协议矩阵之后再次生效，表现为“初始姿态斜着、某个轴又反了”。pose contract v1 会在 GAN V4 首次重连时只清除一次未版本化的旧补偿；之后用户在当前版本主动设置的显示偏好仍会保留。

一组红色中心持续朝向用户、整颗魔方绕红—橙轴旋转的脱敏真机 fixture 得到 X 主导相对轴，已固化在 `orientation.test.ts`。如果省略 X/Y 重排，同一动作会错误显示为 Y 主导，这也是早期 3D 视图轴错位的根因。

GAN16 ui 当前固件的独立 4-bit angular velocity 在受控采样中可能持续为零，因此动态轴识别不得只依赖 velocity；实现会回退到连续四元数差分。原始四元数时间序列只在信号实验室内存窗口中使用，不写入 JSONL。

## 可靠性策略

应用以完整 snapshot 的 counter 建立基线。实时 move 先进入按 16-bit counter 排序的 FIFO；发现 gap 时优先请求 `0xD1` 历史窗口，并把响应中的 8-bit counter 按当前 epoch 展开回 16-bit。补齐后按原顺序交付 Trainer，时间线保持连续。

连续三次历史请求仍无法补齐时才降级请求完整 snapshot。snapshot 会在 `MoveTimeline` 中写入显式 discontinuity；后续分析不得把两段状态拼成完整解法，也不会给历史动作伪造设备时间戳。

设备 `uint32` 时间戳由 `CubeClock` 展开并与 host receive time 建立低通 offset。动作间隔、最终成绩和阶段 TPS 优先使用设备时钟；本地时钟只负责显示插值、offset 观察和没有设备时间的降级路径。

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
