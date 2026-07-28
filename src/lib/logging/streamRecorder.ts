import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Full-fidelity protocol stream recorder. Every line is a JSON object:
 *
 *   { "schemaVersion": 1, "unixMs": ..., "monoMs": ..., "topic": ..., "data": {...} }
 *
 * Topics produced by the trainer:
 *   - "frame":   every decrypted BLE notification (hex bytes are replayable
 *                through parseGanV4Packet) plus invalid frames;
 *   - "pose":    every orientation observation with the health-gate verdict;
 *   - "move":    every domain move event;
 *   - "session": connect/disconnect/anchor/calibration lifecycle.
 *
 * Lines are buffered and flushed in batches to the Rust side, which appends
 * them to cfop-trainer-stream.jsonl in the app log directory, rotating at
 * 10 MiB and keeping 5 files (50 MiB total). This channel deliberately
 * carries quaternion and packet bytes for offline analysis; it must never be
 * fed device identity (addresses, names, manufacturer data) or key material.
 */

const FLUSH_INTERVAL_MS = 500;
const FLUSH_LINE_THRESHOLD = 256;
const MAX_BUFFER_LINES = 4096;

let buffer: string[] = [];
let droppedLines = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let flushQueue: Promise<void> = Promise.resolve();

function flush(): void {
  if (buffer.length === 0) return;
  const lines = buffer;
  buffer = [];
  flushQueue = flushQueue
    .then(() => invoke<void>("write_stream_lines", { lines }))
    .catch((error) => {
      console.error("[cfop-trainer:stream] flush-failed", {
        lines: lines.length,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}

function ensureStarted(): void {
  if (timer !== null) return;
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
}

export interface StreamLogInfo {
  directory: string;
  activeFile: string;
  maxFileBytes: number;
  rotatedFiles: number;
  maxTotalBytes: number;
}

export const streamRecorder = {
  record(topic: string, data: Record<string, unknown>): void {
    if (!isTauri()) return;
    ensureStarted();
    buffer.push(
      JSON.stringify({
        schemaVersion: 1,
        unixMs: Date.now(),
        monoMs: Math.round(performance.now() * 1000) / 1000,
        topic,
        data,
      }),
    );
    if (buffer.length > MAX_BUFFER_LINES) {
      droppedLines += buffer.length - MAX_BUFFER_LINES;
      buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
    }
    if (buffer.length >= FLUSH_LINE_THRESHOLD) flush();
  },

  /** Record a raw notification frame as replayable hex. */
  recordFrame(
    protocol: string,
    layer: "decrypted" | "encrypted",
    packetType: string,
    receivedAt: number,
    bytes: Uint8Array,
  ): void {
    let hex = "";
    for (let index = 0; index < bytes.length; index += 1) {
      hex += bytes[index].toString(16).padStart(2, "0");
    }
    this.record("frame", { protocol, layer, packetType, receivedAt, hex });
  },

  async flushNow(): Promise<void> {
    flush();
    await flushQueue;
  },

  droppedLineCount(): number {
    return droppedLines;
  },

  async info(): Promise<StreamLogInfo | null> {
    if (!isTauri()) return null;
    try {
      return await invoke<StreamLogInfo>("stream_log_info");
    } catch (error) {
      console.error("[cfop-trainer:stream] info-failed", error);
      return null;
    }
  },
};
