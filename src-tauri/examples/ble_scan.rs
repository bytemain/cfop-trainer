use std::time::Duration;

use btleplug::{
    api::{Central, Manager as _, Peripheral as _, ScanFilter},
    platform::Manager,
};
use tokio::time::sleep;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;

    if adapters.is_empty() {
        return Err("no Bluetooth adapter found".into());
    }

    for (index, adapter) in adapters.into_iter().enumerate() {
        println!("Scanning BLE adapter {} for 10 seconds…", index + 1);
        adapter.start_scan(ScanFilter::default()).await?;
        sleep(Duration::from_secs(10)).await;

        let mut devices = Vec::new();
        for peripheral in adapter.peripherals().await? {
            let Some(properties) = peripheral.properties().await? else {
                continue;
            };

            let name = properties
                .local_name
                .unwrap_or_else(|| "<unnamed>".to_owned());
            let is_gan_candidate = name.to_ascii_uppercase().starts_with("GAN")
                || properties
                    .services
                    .iter()
                    .any(|uuid| uuid.to_string().starts_with("0000fff0"));

            devices.push((
                is_gan_candidate,
                properties.rssi.unwrap_or(i16::MIN),
                name,
                properties.services,
                properties
                    .manufacturer_data
                    .keys()
                    .copied()
                    .collect::<Vec<_>>(),
            ));
        }

        adapter.stop_scan().await?;
        devices.sort_by(|left, right| right.1.cmp(&left.1));

        if devices.is_empty() {
            println!("No BLE advertisements found.");
            continue;
        }

        for (is_gan, rssi, name, services, manufacturer_ids) in devices {
            println!(
                "{} name={name:?} rssi={} services={:?} manufacturer_ids={:?}",
                if is_gan {
                    "[GAN candidate]"
                } else {
                    "[device]"
                },
                if rssi == i16::MIN {
                    "unknown".to_owned()
                } else {
                    rssi.to_string()
                },
                services,
                manufacturer_ids,
            );
        }
    }

    Ok(())
}
