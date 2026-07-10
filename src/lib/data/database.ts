import Database from "@tauri-apps/plugin-sql";

let databasePromise: Promise<Database> | undefined;

export function getDatabase(): Promise<Database> {
  databasePromise ??= Database.load("sqlite:cfop-trainer.db");
  return databasePromise;
}

export interface SessionSummary {
  id: number;
  mode: string;
  started_at: number;
  total_ms: number | null;
  is_valid: number;
}

export async function recentSessions(limit = 20): Promise<SessionSummary[]> {
  const database = await getDatabase();
  return database.select<SessionSummary[]>(
    `SELECT id, mode, started_at, total_ms, is_valid
       FROM training_session
      ORDER BY started_at DESC
      LIMIT $1`,
    [limit],
  );
}

