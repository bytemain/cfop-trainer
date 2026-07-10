use std::time::Duration;

use btleplug::{
    api::{Central, Manager as _, Peripheral as _, ScanFilter},
    platform::Manager,
};
use tokio::time::sleep;

const GAN_V2_SERVICE: &str = "6e400001-b5a3-f393-e0a9-e50e24dc4179";
const GAN_V3_SERVICE: &str = "8653000a-43e6-47b7-9cb0-5fc21d4ae340";
const GAN_V4_SERVICE: &str = "00000010-0000-fff7-fff6-fff5fff4fff0";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;

    if adapters.is_empty() {
        return Err("no Bluetooth adapter found".into());
    }

    for adapter in adapters {
        println!("Scanning for an awake GAN16 ui for 12 seconds…");
        adapter.start_scan(ScanFilter::default()).await?;
        sleep(Duration::from_secs(12)).await;

        let mut candidates = Vec::new();
        for peripheral in adapter.peripherals().await? {
            let Some(properties) = peripheral.properties().await? else {
                continue;
            };
            let Some(name) = properties.local_name else {
                continue;
            };

            if name.to_ascii_uppercase().starts_with("GAN16UI") {
                candidates.push((properties.rssi.unwrap_or(i16::MIN), name, peripheral));
            }
        }
        adapter.stop_scan().await?;

        candidates.sort_by(|left, right| right.0.cmp(&left.0));
        let Some((_rssi, name, peripheral)) = candidates.into_iter().next() else {
            println!("No GAN16 ui found on this adapter.");
            continue;
        };

        println!("Found {name:?}; connecting…");
        if !peripheral.is_connected().await? {
            peripheral.connect().await?;
        }

        let result = async {
            peripheral.discover_services().await?;
            let services = peripheral.services();
            let service_ids = services
                .iter()
                .map(|service| service.uuid.to_string().to_ascii_lowercase())
                .collect::<Vec<_>>();

            let protocol = if service_ids.iter().any(|uuid| uuid == GAN_V2_SERVICE) {
                "GAN V2"
            } else if service_ids.iter().any(|uuid| uuid == GAN_V3_SERVICE) {
                "GAN V3"
            } else if service_ids.iter().any(|uuid| uuid == GAN_V4_SERVICE) {
                "GAN V4"
            } else {
                "unknown/legacy GAN protocol"
            };
            println!("Detected protocol: {protocol}");

            for service in services {
                println!("service {}", service.uuid);
                let mut characteristics = service.characteristics.iter().collect::<Vec<_>>();
                characteristics.sort_by_key(|characteristic| characteristic.uuid);
                for characteristic in characteristics {
                    println!(
                        "  characteristic {} properties={:?}",
                        characteristic.uuid, characteristic.properties
                    );
                }
            }

            Ok::<_, Box<dyn std::error::Error>>(())
        }
        .await;

        if peripheral.is_connected().await.unwrap_or(false) {
            peripheral.disconnect().await?;
            println!("Disconnected cleanly.");
        }
        result?;
        return Ok(());
    }

    Err("GAN16 ui was not found; wake it with a few turns and retry".into())
}
