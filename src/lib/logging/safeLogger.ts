import { invoke, isTauri } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type SafeLogDetails = Record<
  string,
  string | number | boolean | null | undefined | readonly string[]
>;

export interface SafeLogEntry {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  level: LogLevel;
  scope: string;
  event: string;
  runtime: "tauri" | "web";
  details?: SafeLogDetails;
}

const MAX_BUFFERED_ENTRIES = 500;
const FORBIDDEN_DETAIL_KEYS = new Set([
  "address",
  "deviceaddress",
  "deviceid",
  "mac",
  "manufacturerdata",
  "key",
  "iv",
  "packet",
  "payload",
]);
const entries: SafeLogEntry[] = [];
const listeners = new Set<(entry: SafeLogEntry) => void>();
let sequence = 0;
let persistQueue = Promise.resolve();

function sanitizeDetails(details?: SafeLogDetails): SafeLogDetails | undefined {
  if (!details) return undefined;
  const sanitized: SafeLogDetails = {};
  for (const [key, value] of Object.entries(details)) {
    sanitized[key] = FORBIDDEN_DETAIL_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return sanitized;
}

function persist(entry: SafeLogEntry): void {
  if (!isTauri()) return;
  const line = JSON.stringify(entry);
  persistQueue = persistQueue
    .then(() => invoke<void>("write_jsonl_log", { line }))
    .catch((error) => {
      console.error("[cfop-trainer:logging] persist-failed", {
        event: entry.event,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}

function emit(level: LogLevel, scope: string, event: string, details?: SafeLogDetails): void {
  const entry: SafeLogEntry = {
    schemaVersion: 1,
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    level,
    scope,
    event,
    runtime: isTauri() ? "tauri" : "web",
    details: sanitizeDetails(details),
  };
  const method = level === "debug" ? console.debug : console[level];
  method(`[cfop-trainer:${scope}] ${event}`, entry);

  entries.push(entry);
  if (entries.length > MAX_BUFFERED_ENTRIES) entries.splice(0, entries.length - MAX_BUFFERED_ENTRIES);
  for (const listener of listeners) listener(entry);
  persist(entry);
}

export const safeLogger = {
  debug(scope: string, event: string, details?: SafeLogDetails): void {
    emit("debug", scope, event, details);
  },
  info(scope: string, event: string, details?: SafeLogDetails): void {
    emit("info", scope, event, details);
  },
  warn(scope: string, event: string, details?: SafeLogDetails): void {
    emit("warn", scope, event, details);
  },
  error(scope: string, event: string, details?: SafeLogDetails): void {
    emit("error", scope, event, details);
  },
  entries(): readonly SafeLogEntry[] {
    return entries.map((entry) => ({ ...entry, details: entry.details ? { ...entry.details } : undefined }));
  },
  subscribe(listener: (entry: SafeLogEntry) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  clearMemoryBuffer(): void {
    entries.length = 0;
  },
};
