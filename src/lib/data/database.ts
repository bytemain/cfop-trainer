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

export interface RememberedCubeDevice {
  platform_device_id: string;
  display_name: string | null;
  model: string | null;
  protocol_version: string | null;
  last_connected_at: number | null;
}

export async function rememberCubeDevice(device: RememberedCubeDevice): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO cube_device (
       platform_device_id,
       display_name,
       model,
       protocol_version,
       last_connected_at
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(platform_device_id) DO UPDATE SET
       display_name = excluded.display_name,
       model = excluded.model,
       protocol_version = excluded.protocol_version,
       last_connected_at = excluded.last_connected_at`,
    [
      device.platform_device_id,
      device.display_name,
      device.model,
      device.protocol_version,
      device.last_connected_at,
    ],
  );
}

export async function lastRememberedCubeDevice(): Promise<RememberedCubeDevice | null> {
  const database = await getDatabase();
  const devices = await database.select<RememberedCubeDevice[]>(
    `SELECT platform_device_id, display_name, model, protocol_version, last_connected_at
       FROM cube_device
      ORDER BY last_connected_at DESC
      LIMIT 1`,
  );
  return devices[0] ?? null;
}
