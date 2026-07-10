use std::time::{Duration, Instant};

use aes::{
    cipher::{generic_array::GenericArray, BlockDecrypt, BlockEncrypt, KeyInit},
    Aes128,
};
use btleplug::{
    api::{Central, Manager as _, Peripheral as _, ScanFilter, WriteType},
    platform::Manager,
};
use futures_util::StreamExt;
use tokio::time::{sleep, timeout};

const READ_UUID: &str = "0000fff6-0000-1000-8000-00805f9b34fb";
const WRITE_UUID: &str = "0000fff5-0000-1000-8000-00805f9b34fb";
const BASE_KEY: [u8; 16] = [1, 2, 66, 40, 49, 145, 22, 7, 32, 5, 24, 84, 66, 17, 18, 83];
const BASE_IV: [u8; 16] = [
    17, 3, 50, 40, 33, 1, 118, 39, 32, 149, 120, 20, 50, 18, 2, 67,
];

struct GanCipher {
    aes: Aes128,
    iv: [u8; 16],
}

impl GanCipher {
    fn from_salt(salt: &[u8]) -> Result<Self, Box<dyn std::error::Error>> {
        if salt.len() != 6 {
            return Err("GAN cipher salt must contain six bytes".into());
        }
        let mut key = BASE_KEY;
        let mut iv = BASE_IV;
        for index in 0..6 {
            key[index] = ((key[index] as u16 + salt[index] as u16) % 255) as u8;
            iv[index] = ((iv[index] as u16 + salt[index] as u16) % 255) as u8;
        }
        Ok(Self {
            aes: Aes128::new(GenericArray::from_slice(&key)),
            iv,
        })
    }

    fn encode(&self, plain: &[u8]) -> Vec<u8> {
        let mut encoded = plain.to_vec();
        for (byte, iv) in encoded[..16].iter_mut().zip(self.iv) {
            *byte ^= iv;
        }
        self.encrypt_block(&mut encoded[..16]);
        if encoded.len() > 16 {
            let offset = encoded.len() - 16;
            for index in 0..16 {
                encoded[offset + index] ^= self.iv[index];
            }
            self.encrypt_block(&mut encoded[offset..]);
        }
        encoded
    }

    fn decode(&self, encrypted: &[u8]) -> Vec<u8> {
        let mut decoded = encrypted.to_vec();
        if decoded.len() > 16 {
            let offset = decoded.len() - 16;
            self.decrypt_block(&mut decoded[offset..]);
            for index in 0..16 {
                decoded[offset + index] ^= self.iv[index];
            }
        }
        self.decrypt_block(&mut decoded[..16]);
        for (byte, iv) in decoded[..16].iter_mut().zip(self.iv) {
            *byte ^= iv;
        }
        decoded
    }

    fn encrypt_block(&self, block: &mut [u8]) {
        self.aes.encrypt_block(GenericArray::from_mut_slice(block));
    }

    fn decrypt_block(&self, block: &mut [u8]) {
        self.aes.decrypt_block(GenericArray::from_mut_slice(block));
    }
}

fn cipher_candidates(payload: &[u8]) -> Vec<(String, GanCipher)> {
    let mut result = Vec::new();
    for offset in 0..=payload.len().saturating_sub(6) {
        let window = &payload[offset..offset + 6];
        if let Ok(cipher) = GanCipher::from_salt(window) {
            result.push((format!("offset-{offset}-forward"), cipher));
        }
        let reversed = window.iter().rev().copied().collect::<Vec<_>>();
        if let Ok(cipher) = GanCipher::from_salt(&reversed) {
            result.push((format!("offset-{offset}-reversed"), cipher));
        }
    }
    result
}

fn semantic_score(cipher: &GanCipher, packets: &[Vec<u8>]) -> usize {
    const KNOWN_MODES: [u8; 18] = [
        0x01, 0xd1, 0xec, 0xed, 0xef, 0xf5, 0xf6, 0xfa, 0xfc, 0xfd, 0xfe, 0xff, 0x10, 0x20, 0x21,
        0x22, 0x23, 0x24,
    ];
    packets
        .iter()
        .filter(|packet| {
            if packet.len() < 16 {
                return false;
            }
            let decoded = cipher.decode(packet);
            KNOWN_MODES.contains(&decoded[0]) && decoded[1] <= 20
        })
        .count()
}

fn request(kind: &str) -> [u8; 20] {
    let mut value = [0; 20];
    match kind {
        "hardware" => {
            value[0] = 0xdf;
            value[1] = 0x03;
        }
        "snapshot" => {
            value[0] = 0xdd;
            value[1] = 0x04;
            value[3] = 0xed;
        }
        "battery" => {
            value[0] = 0xdd;
            value[1] = 0x04;
            value[3] = 0xef;
        }
        _ => unreachable!(),
    }
    value
}

fn describe_packet(value: &[u8]) {
    if value.len() < 16 {
        println!("Ignored a truncated GAN packet.");
        return;
    }
    let mode = value[0];
    let len = value[1] as usize;
    match mode {
        0x01 => {
            let sequence = u16::from_le_bytes([value[6], value[7]]);
            let axis_code = value[8] & 0x3f;
            let face = [2, 32, 8, 1, 16, 4]
                .iter()
                .position(|candidate| *candidate == axis_code)
                .and_then(|index| "URFDLB".chars().nth(index));
            let suffix = if value[8] >> 6 == 1 { "'" } else { "" };
            println!(
                "Move: {}{} (counter {sequence})",
                face.unwrap_or('?'),
                suffix
            );
        }
        0xed => {
            let sequence = u16::from_le_bytes([value[2], value[3]]);
            println!("Snapshot received (counter {sequence}, complete cubie payload).");
        }
        0xef => {
            let offset = 1 + len;
            if offset < value.len() {
                println!("Battery: {}%", value[offset]);
            }
        }
        0xec => {}
        0xfc => println!("Hardware name response received."),
        0xfd => println!("Software version: {}.{}", value[3] >> 4, value[3] & 0x0f),
        0xfe => println!("Hardware version: {}.{}", value[3] >> 4, value[3] & 0x0f),
        0xf5 | 0xf6 | 0xfa | 0xff => println!("Hardware metadata response 0x{mode:02x} received."),
        0xd1 => println!("Move history response received."),
        _ => println!("Other GAN V4 response 0x{mode:02x} received."),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;
    for adapter in adapters {
        println!("Scanning for GAN16 ui for 10 seconds…");
        adapter.start_scan(ScanFilter::default()).await?;
        sleep(Duration::from_secs(10)).await;

        let mut candidates = Vec::new();
        for peripheral in adapter.peripherals().await? {
            let Some(properties) = peripheral.properties().await? else {
                continue;
            };
            let Some(name) = properties.local_name else {
                continue;
            };
            if !name.to_ascii_uppercase().starts_with("GAN16UI") {
                continue;
            }
            let manufacturer = properties
                .manufacturer_data
                .iter()
                .find(|(company_id, value)| (**company_id & 0xff) == 0x01 && value.len() >= 6)
                .map(|(_, value)| value.clone());
            candidates.push((
                properties.rssi.unwrap_or(i16::MIN),
                name,
                manufacturer,
                peripheral,
            ));
        }
        adapter.stop_scan().await?;
        candidates.sort_by(|left, right| right.0.cmp(&left.0));
        let Some((_rssi, name, Some(manufacturer), peripheral)) = candidates.into_iter().next()
        else {
            continue;
        };

        println!("Connecting to {name:?} with ephemeral GAN V4 credentials…");
        peripheral.connect().await?;
        peripheral.discover_services().await?;
        let characteristics = peripheral.characteristics();
        let read = characteristics
            .iter()
            .find(|value| value.uuid.to_string() == READ_UUID)
            .ok_or("GAN V4 notification characteristic not found")?
            .clone();
        let write = characteristics
            .iter()
            .find(|value| value.uuid.to_string() == WRITE_UUID)
            .ok_or("GAN V4 write characteristic not found")?
            .clone();

        peripheral.subscribe(&read).await?;
        let mut notifications = peripheral.notifications().await?;
        let sampling_deadline = Instant::now() + Duration::from_secs(2);
        let mut samples = Vec::new();
        while Instant::now() < sampling_deadline && samples.len() < 100 {
            if let Ok(Some(notification)) =
                timeout(Duration::from_millis(250), notifications.next()).await
            {
                if notification.uuid == read.uuid && notification.value.len() >= 16 {
                    samples.push(notification.value);
                }
            }
        }
        let mut candidates = cipher_candidates(&manufacturer);
        candidates.sort_by_key(|(_, cipher)| std::cmp::Reverse(semantic_score(cipher, &samples)));
        let Some((layout, cipher)) = candidates.into_iter().next() else {
            return Err("unable to build GAN V4 cipher candidates".into());
        };
        let score = semantic_score(&cipher, &samples);
        println!(
            "Selected private manufacturer layout {layout} ({score}/{} semantic packets).",
            samples.len()
        );
        if samples.is_empty() || score * 2 < samples.len() {
            return Err("no manufacturer layout produced a credible GAN V4 stream".into());
        }

        for kind in ["hardware", "snapshot", "battery"] {
            peripheral
                .write(
                    &write,
                    &cipher.encode(&request(kind)),
                    WriteType::WithResponse,
                )
                .await?;
            sleep(Duration::from_millis(100)).await;
        }
        println!("Listening for semantic responses and turns for 15 seconds…");

        let deadline = Instant::now() + Duration::from_secs(15);
        let mut captured_snapshot = false;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match timeout(remaining, notifications.next()).await {
                Ok(Some(notification)) if notification.uuid == read.uuid => {
                    if notification.value.len() < 16 {
                        continue;
                    }
                    let decoded = cipher.decode(&notification.value);
                    if decoded[0] == 0xed && !captured_snapshot {
                        let fixture = decoded
                            .iter()
                            .map(|byte| format!("{byte:02x}"))
                            .collect::<String>();
                        println!("Sanitized snapshot fixture (no MAC/address): {fixture}");
                        captured_snapshot = true;
                    }
                    if decoded[0] != 0xed || !captured_snapshot || decoded[0] == 0x01 {
                        describe_packet(&decoded);
                    }
                }
                Ok(Some(_)) => {}
                _ => break,
            }
        }

        peripheral.unsubscribe(&read).await.ok();
        peripheral.disconnect().await?;
        println!("Disconnected cleanly; no identifying BLE material was printed or stored.");
        return Ok(());
    }

    Err("GAN16 ui with usable manufacturer data was not found".into())
}
