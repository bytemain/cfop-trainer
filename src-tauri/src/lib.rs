use tauri_plugin_sql::{Migration, MigrationKind};

const INITIAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS cube_device (
  id INTEGER PRIMARY KEY,
  platform_device_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  model TEXT,
  firmware TEXT,
  protocol_version TEXT,
  last_connected_at INTEGER
);

CREATE TABLE IF NOT EXISTS training_session (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  total_ms INTEGER,
  scramble TEXT,
  cross_color TEXT,
  splits_json TEXT,
  result_json TEXT,
  timing_source TEXT NOT NULL,
  device_id INTEGER,
  device_model TEXT,
  device_firmware TEXT,
  protocol_version TEXT,
  recognizer_version TEXT,
  algorithm_dataset_version TEXT,
  had_desync INTEGER NOT NULL DEFAULT 0,
  is_valid INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  FOREIGN KEY(device_id) REFERENCES cube_device(id)
);

CREATE TABLE IF NOT EXISTS session_event (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  cube_ts INTEGER,
  received_ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES training_session(id) ON DELETE CASCADE,
  UNIQUE(session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_session_mode_started_at
ON training_session(mode, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_session_seq
ON session_event(session_id, seq);
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create initial training schema",
        sql: INITIAL_SCHEMA,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_blec::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cfop-trainer.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
