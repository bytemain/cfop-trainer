import type { CubeSignalFrameEvent } from "$lib/protocols/gan/types";
import { parseGanV4Packet, type GanV4Packet } from "./parser";

export type GanV4DiagnosticSeverity = "warning" | "error";

export interface GanV4DiagnosticIssue {
  code: string;
  severity: GanV4DiagnosticSeverity;
  message: string;
  count: number;
  lastSeenAt: number;
}

export interface GanV4ProtocolDiagnosticSnapshot {
  totalFrames: number;
  parsedFrames: number;
  invalidFrames: number;
  unknownFrames: number;
  snapshotZeroCounters: number;
  moveSequenceGaps: number;
  lastPacketType: CubeSignalFrameEvent["packetType"] | null;
  lastMode: number | null;
  lastFrameAt: number | null;
  packetCounts: Record<CubeSignalFrameEvent["packetType"], number>;
  issues: GanV4DiagnosticIssue[];
}

const PACKET_TYPES: CubeSignalFrameEvent["packetType"][] = [
  "gyro",
  "move",
  "move-history",
  "snapshot",
  "battery",
  "hardware",
  "unknown",
  "invalid",
];

function emptyPacketCounts(): GanV4ProtocolDiagnosticSnapshot["packetCounts"] {
  return Object.fromEntries(PACKET_TYPES.map((type) => [type, 0])) as GanV4ProtocolDiagnosticSnapshot["packetCounts"];
}

export function createEmptyGanV4ProtocolDiagnostics(): GanV4ProtocolDiagnosticSnapshot {
  return {
    totalFrames: 0,
    parsedFrames: 0,
    invalidFrames: 0,
    unknownFrames: 0,
    snapshotZeroCounters: 0,
    moveSequenceGaps: 0,
    lastPacketType: null,
    lastMode: null,
    lastFrameAt: null,
    packetCounts: emptyPacketCounts(),
    issues: [],
  };
}

export class GanV4ProtocolDiagnostics {
  private snapshot = createEmptyGanV4ProtocolDiagnostics();
  private lastMoveSequence: number | null = null;
  private issueMap = new Map<string, GanV4DiagnosticIssue>();

  reset(): GanV4ProtocolDiagnosticSnapshot {
    this.snapshot = createEmptyGanV4ProtocolDiagnostics();
    this.lastMoveSequence = null;
    this.issueMap.clear();
    return this.current();
  }

  observe(frame: CubeSignalFrameEvent): GanV4ProtocolDiagnosticSnapshot {
    this.snapshot.totalFrames += 1;
    this.snapshot.lastFrameAt = frame.receivedAt;
    this.snapshot.lastPacketType = frame.packetType;
    this.snapshot.packetCounts[frame.packetType] += 1;

    if (frame.layer !== "decrypted" || frame.bytes.length === 0 || frame.packetType === "invalid") {
      this.snapshot.invalidFrames += 1;
      this.recordIssue("packet-decode-failed", "error", "存在无法解密或解析的 GAN V4 包", frame.receivedAt);
      return this.current();
    }

    this.snapshot.lastMode = frame.bytes[0] ?? null;
    if (frame.bytes.length !== 20) {
      this.recordIssue(
        "unexpected-packet-length",
        "warning",
        `收到 ${frame.bytes.length} 字节包，当前实机契约通常为 20 字节`,
        frame.receivedAt,
      );
    }

    try {
      const packet = parseGanV4Packet(frame.bytes);
      this.snapshot.parsedFrames += 1;
      this.inspectPacket(packet, frame.receivedAt);
    } catch (error) {
      this.snapshot.invalidFrames += 1;
      this.recordIssue(
        "packet-parse-failed",
        "error",
        error instanceof Error ? error.message : String(error),
        frame.receivedAt,
      );
    }
    return this.current();
  }

  current(): GanV4ProtocolDiagnosticSnapshot {
    return {
      ...this.snapshot,
      packetCounts: { ...this.snapshot.packetCounts },
      issues: [...this.issueMap.values()].sort((left, right) => {
        if (left.severity !== right.severity) return left.severity === "error" ? -1 : 1;
        return right.lastSeenAt - left.lastSeenAt;
      }),
    };
  }

  private inspectPacket(packet: GanV4Packet, receivedAt: number): void {
    if (packet.type === "unknown") {
      this.snapshot.unknownFrames += 1;
      this.recordIssue(
        `unknown-mode-${packet.mode.toString(16).padStart(2, "0")}`,
        "warning",
        `尚未建模的 GAN V4 mode 0x${packet.mode.toString(16).padStart(2, "0")}`,
        receivedAt,
      );
      return;
    }

    if (packet.type === "snapshot" && packet.sequence === 0) {
      this.snapshot.snapshotZeroCounters += 1;
      this.recordIssue(
        "snapshot-zero-counter",
        "warning",
        "0xED 状态包返回 move counter 0；已禁止它重置实时 move baseline",
        receivedAt,
      );
      return;
    }

    if (packet.type === "battery" && (packet.level < 0 || packet.level > 100)) {
      this.recordIssue("battery-out-of-range", "error", `电量字段越界：${packet.level}`, receivedAt);
      return;
    }

    if (packet.type === "gyro") {
      const { x, y, z, w } = packet.quaternion;
      const norm = Math.hypot(x, y, z, w);
      if (!Number.isFinite(norm) || norm < 0.85 || norm > 1.15) {
        this.recordIssue(
          "quaternion-norm-out-of-range",
          "error",
          `0xEC 四元数模长异常：${Number.isFinite(norm) ? norm.toFixed(3) : "非有限值"}`,
          receivedAt,
        );
      }
      return;
    }

    if (packet.type === "move") {
      if (this.lastMoveSequence !== null) {
        const distance = (packet.sequence - this.lastMoveSequence) & 0xffff;
        if (distance > 1 && distance < 0x8000) {
          this.snapshot.moveSequenceGaps += 1;
          this.recordIssue(
            "move-sequence-gap",
            "warning",
            `实时 move sequence 跳跃 ${this.lastMoveSequence} → ${packet.sequence}`,
            receivedAt,
          );
        }
      }
      this.lastMoveSequence = packet.sequence;
    }
  }

  private recordIssue(
    code: string,
    severity: GanV4DiagnosticSeverity,
    message: string,
    receivedAt: number,
  ): void {
    const previous = this.issueMap.get(code);
    this.issueMap.set(code, {
      code,
      severity,
      message,
      count: (previous?.count ?? 0) + 1,
      lastSeenAt: receivedAt,
    });
  }
}
