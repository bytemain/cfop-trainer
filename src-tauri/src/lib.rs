use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "macos")]
use btleplug::{
    api::{
        Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _,
        ScanFilter, WriteType,
    },
    platform::{Adapter, Manager as BleManager, Peripheral, PeripheralId},
};
#[cfg(target_os = "macos")]
use futures_util::StreamExt;
use serde_json::Value;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, HELP_SUBMENU_ID};
use tauri::{ipc::Channel, Manager, Runtime};
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::sync::mpsc;
#[cfg(target_os = "macos")]
use tokio::{
    sync::Mutex as AsyncMutex,
    task::JoinHandle,
    time::{timeout, Duration, Instant},
};
use uuid::Uuid;

const JSONL_FILE_NAME: &str = "cfop-trainer.jsonl";
const JSONL_MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
const JSONL_ROTATED_FILES: usize = 3;
const JSONL_MAX_LINE_SIZE: usize = 16 * 1024;

#[derive(Default)]
struct JsonlLogState {
    write_lock: Mutex<()>,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct NativeBleInner {
    adapter: Option<Adapter>,
    peripherals: HashMap<String, Peripheral>,
    connected: Option<Peripheral>,
    notification_task: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct NativeBleState {
    #[cfg(target_os = "macos")]
    inner: AsyncMutex<NativeBleInner>,
    #[cfg(target_os = "macos")]
    operation: AsyncMutex<()>,
}

#[cfg(target_os = "macos")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBleDevice {
    id: String,
    name: String,
    rssi: Option<i16>,
    service_uuids: Vec<String>,
    manufacturer_data: HashMap<u16, Vec<u8>>,
}

fn rotated_log_path(active: &Path, index: usize) -> PathBuf {
    active.with_file_name(format!("cfop-trainer.{index}.jsonl"))
}

fn rotate_jsonl_logs(active: &Path) -> Result<(), String> {
    let oldest = rotated_log_path(active, JSONL_ROTATED_FILES);
    if oldest.exists() {
        fs::remove_file(&oldest).map_err(|error| error.to_string())?;
    }

    for index in (1..JSONL_ROTATED_FILES).rev() {
        let from = rotated_log_path(active, index);
        let to = rotated_log_path(active, index + 1);
        if from.exists() {
            fs::rename(from, to).map_err(|error| error.to_string())?;
        }
    }

    if active.exists() {
        fs::rename(active, rotated_log_path(active, 1)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn contains_forbidden_log_key(value: &Value) -> bool {
    const FORBIDDEN: [&str; 9] = [
        "address",
        "deviceaddress",
        "deviceid",
        "mac",
        "manufacturerdata",
        "key",
        "iv",
        "packet",
        "payload",
    ];

    match value {
        Value::Object(values) => values.iter().any(|(key, value)| {
            FORBIDDEN.contains(&key.to_ascii_lowercase().as_str())
                || contains_forbidden_log_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_forbidden_log_key),
        _ => false,
    }
}

fn append_jsonl<R: Runtime>(app: &tauri::AppHandle<R>, line: &str) -> Result<(), String> {
    if line.len() > JSONL_MAX_LINE_SIZE {
        return Err("log entry exceeds the 16 KiB safety limit".to_owned());
    }

    let value: Value = serde_json::from_str(line).map_err(|_| "log entry is not valid JSON")?;
    if !value.is_object() {
        return Err("log entry must be a JSON object".to_owned());
    }
    if contains_forbidden_log_key(&value) {
        return Err("log entry contains a forbidden sensitive field".to_owned());
    }
    let canonical = serde_json::to_string(&value).map_err(|error| error.to_string())?;

    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let active = directory.join(JSONL_FILE_NAME);
    let current_size = active
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if current_size + canonical.len() as u64 + 1 > JSONL_MAX_FILE_SIZE {
        rotate_jsonl_logs(&active)?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(active)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{canonical}").map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())
}

fn write_native_jsonl<R: Runtime>(
    app: &tauri::AppHandle<R>,
    level: &str,
    scope: &str,
    event: &str,
    details: Value,
) {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let entry = serde_json::json!({
        "schemaVersion": 1,
        "sequence": 0,
        "timestamp": format!("unix-ms:{timestamp_ms}"),
        "level": level,
        "scope": scope,
        "event": event,
        "runtime": "tauri-native",
        "details": details,
    });
    let state = app.state::<JsonlLogState>();
    if let Ok(_guard) = state.write_lock.lock() {
        let _ = append_jsonl(app, &entry.to_string());
    };
}

#[tauri::command]
fn write_jsonl_log<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, JsonlLogState>,
    line: String,
) -> Result<(), String> {
    let _guard = state
        .write_lock
        .lock()
        .map_err(|_| "JSONL logger lock is poisoned".to_owned())?;
    append_jsonl(&app, &line)
}

#[tauri::command]
fn save_json_export<R: Runtime>(
    app: tauri::AppHandle<R>,
    filename: String,
    content: String,
) -> Result<String, String> {
    if content.len() > 1024 * 1024 {
        return Err("JSON export exceeds the 1 MiB safety limit".to_owned());
    }
    if !filename.ends_with(".json")
        || filename.is_empty()
        || !filename
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_'))
    {
        return Err("JSON export filename is invalid".to_owned());
    }
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("JSON export content is invalid: {error}"))?;
    let canonical = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    let directory = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

    let mut path = directory.join(&filename);
    if path.exists() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        let stem = filename.trim_end_matches(".json");
        path = directory.join(format!("{stem}-{timestamp}.json"));
    }
    fs::write(&path, canonical).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn gan_ble_subscribe<R: Runtime>(
    app: tauri::AppHandle<R>,
    characteristic: String,
    service: Option<String>,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    let characteristic = Uuid::parse_str(&characteristic).map_err(|error| error.to_string())?;
    let service = service
        .map(|value| Uuid::parse_str(&value).map_err(|error| error.to_string()))
        .transpose()?;
    let handler = tauri_plugin_blec::get_handler().map_err(|error| error.to_string())?;
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(128);
    let dropped = Arc::new(AtomicU64::new(0));
    let dropped_for_callback = dropped.clone();
    let app_for_callback = app.clone();

    handler
        .subscribe(characteristic, service, move |data: Vec<u8>| {
            if let Err(error) = tx.try_send(data) {
                if matches!(error, mpsc::error::TrySendError::Full(_)) {
                    let count = dropped_for_callback.fetch_add(1, Ordering::Relaxed) + 1;
                    if count == 1 || count % 100 == 0 {
                        write_native_jsonl(
                            &app_for_callback,
                            "warn",
                            "ble-native",
                            "notification-queue-pressure",
                            serde_json::json!({ "droppedNotifications": count }),
                        );
                    }
                }
            }
        })
        .await
        .map_err(|error| error.to_string())?;

    write_native_jsonl(
        &app,
        "info",
        "ble-native",
        "notification-subscription-active",
        serde_json::json!({
            "characteristic": characteristic.to_string(),
            "queueCapacity": 128,
        }),
    );

    tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            if on_data.send(data).is_err() {
                write_native_jsonl(
                    &app,
                    "warn",
                    "ble-native",
                    "notification-channel-closed",
                    serde_json::json!({
                        "droppedNotifications": dropped.load(Ordering::Relaxed),
                    }),
                );
                break;
            }
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn event_peripheral_id(event: &CentralEvent) -> Option<PeripheralId> {
    match event {
        CentralEvent::DeviceDiscovered(id)
        | CentralEvent::DeviceUpdated(id)
        | CentralEvent::DeviceConnected(id)
        | CentralEvent::DeviceDisconnected(id)
        | CentralEvent::DeviceServicesModified(id) => Some(id.clone()),
        CentralEvent::ManufacturerDataAdvertisement { id, .. }
        | CentralEvent::ServiceDataAdvertisement { id, .. }
        | CentralEvent::ServicesAdvertisement { id, .. }
        | CentralEvent::RssiUpdate { id, .. } => Some(id.clone()),
        CentralEvent::StateUpdate(_) => None,
    }
}

#[cfg(target_os = "macos")]
async fn first_native_adapter() -> Result<Adapter, String> {
    let manager = BleManager::new().await.map_err(|error| error.to_string())?;
    manager
        .adapters()
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "未发现可用的 macOS 蓝牙适配器。".to_owned())
}

#[cfg(target_os = "macos")]
fn native_characteristic(
    peripheral: &Peripheral,
    service: &str,
    characteristic: &str,
) -> Result<Characteristic, String> {
    let service = Uuid::parse_str(service).map_err(|error| error.to_string())?;
    let characteristic = Uuid::parse_str(characteristic).map_err(|error| error.to_string())?;
    peripheral
        .characteristics()
        .into_iter()
        .find(|value| value.uuid == characteristic && value.service_uuid == service)
        .ok_or_else(|| format!("GATT characteristic {characteristic} is unavailable"))
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_adapter_available() -> Result<bool, String> {
    let adapter = first_native_adapter().await?;
    Ok(matches!(
        adapter
            .adapter_state()
            .await
            .map_err(|error| error.to_string())?,
        CentralState::PoweredOn
    ))
}

#[tauri::command]
fn ble_backend() -> &'static str {
    if cfg!(target_os = "macos") {
        "native-macos"
    } else {
        "plugin-blec"
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_adapter_available() -> Result<bool, String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_scan<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeBleState>,
    timeout_ms: u64,
    prefixes: Vec<String>,
) -> Result<Vec<NativeBleDevice>, String> {
    let _operation = state.operation.lock().await;
    let stale_connection = {
        let mut inner = state.inner.lock().await;
        if let Some(task) = inner.notification_task.take() {
            task.abort();
        }
        inner.connected.take()
    };
    if let Some(peripheral) = stale_connection {
        let connected = timeout(Duration::from_secs(3), peripheral.is_connected())
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        if connected {
            let _ = timeout(Duration::from_secs(5), peripheral.disconnect()).await;
            write_native_jsonl(
                &app,
                "info",
                "ble-native",
                "stale-connection-reset",
                serde_json::json!({ "reason": "new-scan" }),
            );
        }
    }

    let adapter = first_native_adapter().await?;
    if !matches!(
        adapter
            .adapter_state()
            .await
            .map_err(|error| error.to_string())?,
        CentralState::PoweredOn
    ) {
        return Err("macOS 蓝牙当前未开启。".to_owned());
    }

    // CoreBluetooth retains peripherals long after they stop advertising. The plugin's
    // polling scanner therefore produced stale GAN rows that could never connect. Start
    // from an empty cache and accept only IDs announced by this scan's event stream.
    let _ = adapter.stop_scan().await;
    let _ = adapter.clear_peripherals().await;
    let mut events = adapter.events().await.map_err(|error| error.to_string())?;
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(|error| error.to_string())?;

    write_native_jsonl(
        &app,
        "info",
        "ble-native",
        "fresh-scan-start",
        serde_json::json!({ "timeoutMs": timeout_ms }),
    );

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut fresh = HashMap::<String, Peripheral>::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = match timeout(remaining, events.next()).await {
            Ok(Some(event)) => event,
            Ok(None) | Err(_) => break,
        };
        let Some(id) = event_peripheral_id(&event) else {
            continue;
        };
        let peripheral = match adapter.peripheral(&id).await {
            Ok(peripheral) => peripheral,
            Err(_) => continue,
        };
        let properties = match peripheral.properties().await {
            Ok(Some(properties)) => properties,
            _ => continue,
        };
        let name = properties.local_name.unwrap_or_default();
        if prefixes
            .iter()
            .any(|prefix| name.to_uppercase().starts_with(&prefix.to_uppercase()))
        {
            fresh.insert(id.to_string(), peripheral);
        }
    }
    let _ = adapter.stop_scan().await;

    let mut devices = Vec::new();
    for (id, peripheral) in &fresh {
        let Some(properties) = peripheral
            .properties()
            .await
            .map_err(|error| error.to_string())?
        else {
            continue;
        };
        devices.push(NativeBleDevice {
            id: id.clone(),
            name: properties
                .local_name
                .unwrap_or_else(|| "Unknown BLE device".to_owned()),
            rssi: properties.rssi,
            service_uuids: properties
                .services
                .iter()
                .map(ToString::to_string)
                .collect(),
            manufacturer_data: properties.manufacturer_data,
        });
    }
    devices.sort_by_key(|device| std::cmp::Reverse(device.rssi.unwrap_or(i16::MIN)));

    let mut inner = state.inner.lock().await;
    inner.adapter = Some(adapter);
    inner.peripherals = fresh;
    write_native_jsonl(
        &app,
        "info",
        "ble-native",
        "fresh-scan-complete",
        serde_json::json!({
            "candidates": devices.len(),
            "names": devices.iter().map(|device| device.name.as_str()).collect::<Vec<_>>(),
        }),
    );
    Ok(devices)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_scan(_timeout_ms: u64, _prefixes: Vec<String>) -> Result<Vec<Value>, String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_connect<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeBleState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let _operation = state.operation.lock().await;
    let (previous, peripheral) = {
        let mut inner = state.inner.lock().await;
        if let Some(task) = inner.notification_task.take() {
            task.abort();
        }
        let previous = inner.connected.take();
        let peripheral = inner
            .peripherals
            .get(&id)
            .cloned()
            .ok_or_else(|| "设备已不在本轮扫描结果中，请唤醒魔方后重新扫描。".to_owned())?;
        (previous, peripheral)
    };
    if let Some(previous) = previous {
        let _ = timeout(Duration::from_secs(5), previous.disconnect()).await;
    }

    write_native_jsonl(
        &app,
        "info",
        "ble-native",
        "connect-start",
        serde_json::json!({ "name": name }),
    );
    let already_connected = timeout(Duration::from_secs(3), peripheral.is_connected())
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false);
    if already_connected {
        let _ = timeout(Duration::from_secs(5), peripheral.disconnect()).await;
    }
    if let Err(error) = peripheral
        .connect_with_timeout(Duration::from_secs(12))
        .await
    {
        let _ = timeout(Duration::from_secs(5), peripheral.disconnect()).await;
        write_native_jsonl(
            &app,
            "error",
            "ble-native",
            "connect-failed",
            serde_json::json!({ "name": name, "reason": error.to_string() }),
        );
        return Err(format!(
            "连接 GAN16 ui 超时；请连续转动魔方保持广播后立即重试。 ({error})"
        ));
    }
    if let Err(error) = peripheral
        .discover_services_with_timeout(Duration::from_secs(8))
        .await
    {
        let _ = timeout(Duration::from_secs(5), peripheral.disconnect()).await;
        return Err(format!("连接成功，但 GATT 服务发现失败：{error}"));
    }
    let mut inner = state.inner.lock().await;
    inner.connected = Some(peripheral);
    write_native_jsonl(
        &app,
        "info",
        "ble-native",
        "connect-success",
        serde_json::json!({ "name": name }),
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_connect(_id: String, _name: String) -> Result<(), String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_read(
    state: tauri::State<'_, NativeBleState>,
    service: String,
    characteristic: String,
) -> Result<Vec<u8>, String> {
    let inner = state.inner.lock().await;
    let peripheral = inner
        .connected
        .as_ref()
        .cloned()
        .ok_or_else(|| "No native BLE device is connected".to_owned())?;
    let characteristic = native_characteristic(&peripheral, &service, &characteristic)?;
    timeout(Duration::from_secs(5), peripheral.read(&characteristic))
        .await
        .map_err(|_| "Timeout during native BLE read".to_owned())?
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_read(_service: String, _characteristic: String) -> Result<Vec<u8>, String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_write(
    state: tauri::State<'_, NativeBleState>,
    service: String,
    characteristic: String,
    data: Vec<u8>,
    with_response: bool,
) -> Result<(), String> {
    let inner = state.inner.lock().await;
    let peripheral = inner
        .connected
        .as_ref()
        .cloned()
        .ok_or_else(|| "No native BLE device is connected".to_owned())?;
    let characteristic = native_characteristic(&peripheral, &service, &characteristic)?;
    let write_type = if with_response {
        WriteType::WithResponse
    } else {
        WriteType::WithoutResponse
    };
    timeout(
        Duration::from_secs(5),
        peripheral.write(&characteristic, &data, write_type),
    )
    .await
    .map_err(|_| "Timeout during native BLE write".to_owned())?
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_write(
    _service: String,
    _characteristic: String,
    _data: Vec<u8>,
    _with_response: bool,
) -> Result<(), String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_subscribe<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, NativeBleState>,
    service: String,
    characteristic: String,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    if let Some(task) = inner.notification_task.take() {
        task.abort();
    }
    let peripheral = inner
        .connected
        .as_ref()
        .cloned()
        .ok_or_else(|| "No native BLE device is connected".to_owned())?;
    let characteristic = native_characteristic(&peripheral, &service, &characteristic)?;
    let mut notifications = peripheral
        .notifications()
        .await
        .map_err(|error| error.to_string())?;
    peripheral
        .subscribe(&characteristic)
        .await
        .map_err(|error| error.to_string())?;

    let expected_uuid = characteristic.uuid;
    let expected_service = characteristic.service_uuid;
    let app_for_notifications = app.clone();
    inner.notification_task = Some(tokio::spawn(async move {
        let mut delivered = 0_u64;
        while let Some(notification) = notifications.next().await {
            if notification.uuid != expected_uuid || notification.service_uuid != expected_service {
                continue;
            }
            delivered += 1;
            if on_data.send(notification.value).is_err() {
                write_native_jsonl(
                    &app_for_notifications,
                    "warn",
                    "ble-native",
                    "notification-channel-closed",
                    serde_json::json!({ "deliveredNotifications": delivered }),
                );
                break;
            }
        }
    }));
    write_native_jsonl(
        &app,
        "info",
        "ble-native",
        "notification-subscription-active",
        serde_json::json!({ "characteristic": characteristic.uuid.to_string() }),
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_subscribe(
    _service: String,
    _characteristic: String,
    _on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_unsubscribe(
    state: tauri::State<'_, NativeBleState>,
    service: String,
    characteristic: String,
) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    if let Some(task) = inner.notification_task.take() {
        task.abort();
    }
    let peripheral = inner
        .connected
        .as_ref()
        .cloned()
        .ok_or_else(|| "No native BLE device is connected".to_owned())?;
    let characteristic = native_characteristic(&peripheral, &service, &characteristic)?;
    peripheral
        .unsubscribe(&characteristic)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_unsubscribe(_service: String, _characteristic: String) -> Result<(), String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn native_ble_disconnect(state: tauri::State<'_, NativeBleState>) -> Result<(), String> {
    let _operation = state.operation.lock().await;
    let peripheral = {
        let mut inner = state.inner.lock().await;
        if let Some(task) = inner.notification_task.take() {
            task.abort();
        }
        inner.connected.take()
    };
    if let Some(peripheral) = peripheral {
        let connected = timeout(Duration::from_secs(3), peripheral.is_connected())
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        if connected {
            timeout(Duration::from_secs(5), peripheral.disconnect())
                .await
                .map_err(|_| "Timeout during native BLE disconnect".to_owned())?
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn native_ble_disconnect() -> Result<(), String> {
    Err("The native desktop BLE backend is only available on macOS".to_owned())
}

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

    let builder = tauri::Builder::default()
        .manage(JsonlLogState::default())
        .manage(NativeBleState::default());

    #[cfg(desktop)]
    let builder = builder
        .menu(|app| {
            let menu = Menu::default(app)?;
            #[cfg(debug_assertions)]
            if let Some(help) = menu
                .get(HELP_SUBMENU_ID)
                .and_then(|item| item.as_submenu().cloned())
            {
                let developer_tools = MenuItem::with_id(
                    app,
                    "open-developer-tools",
                    "Open Developer Tools",
                    true,
                    Some("CmdOrCtrl+Alt+I"),
                )?;
                help.append(&developer_tools)?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            #[cfg(debug_assertions)]
            if event.id().as_ref() == "open-developer-tools" {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                }
            }
        });

    builder
        .invoke_handler(tauri::generate_handler![
            write_jsonl_log,
            save_json_export,
            gan_ble_subscribe,
            ble_backend,
            native_ble_adapter_available,
            native_ble_scan,
            native_ble_connect,
            native_ble_read,
            native_ble_write,
            native_ble_subscribe,
            native_ble_unsubscribe,
            native_ble_disconnect,
        ])
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
