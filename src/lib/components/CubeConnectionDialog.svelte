<script lang="ts">
  import { onMount } from "svelte";
  import {
    Bluetooth,
    BluetoothSearching,
    CircleAlert,
    Radio,
    RefreshCcw,
    X,
  } from "lucide-svelte";
  import StatusPill from "$lib/components/StatusPill.svelte";
  import { CONNECTION_LABELS, trainer } from "$lib/stores/trainer.svelte";

  let {
    onclose,
    autoScan = false,
  }: {
    onclose: () => void;
    autoScan?: boolean;
  } = $props();

  const busy = $derived(
    ["scanning", "connecting", "authenticating", "synchronizing", "reconnecting"].includes(
      trainer.connection,
    ),
  );
  const connectionTone = $derived(
    trainer.connection === "ready"
      ? "success"
      : trainer.connection === "degraded"
        ? "warning"
        : ["scanning", "connecting", "discovering-services", "authenticating", "synchronizing", "reconnecting"].includes(trainer.connection)
          ? "info"
          : ["disconnected", "bluetooth-unavailable", "permission-required"].includes(trainer.connection)
            ? "error"
            : "neutral",
  );

  onMount(() => {
    if (autoScan && !busy) void trainer.scanRealDevices();
  });

  function close(): void {
    if (!busy) onclose();
  }

  async function connect(device: (typeof trainer.devices)[number]): Promise<void> {
    await trainer.connectRealDevice(device);
    if (trainer.connection === "ready" || trainer.connection === "degraded") onclose();
  }
</script>

<div class="device-dialog-backdrop" role="presentation">
  <div
    class="device-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="device-dialog-title"
  >
    <header class="device-dialog-header">
      <div>
        <span class="eyebrow">Bluetooth LE</span>
        <h2 id="device-dialog-title">选择蓝牙魔方</h2>
      </div>
      <button class="dialog-close-button" aria-label="关闭设备选择" disabled={busy} onclick={close}>
        <X size={19} />
      </button>
    </header>

    <div class="device-dialog-status tone-{connectionTone}">
      {#if trainer.connection === "scanning"}
        <BluetoothSearching class="spinning" size={21} />
      {:else if connectionTone === "error"}
        <CircleAlert size={21} />
      {:else}
        <Radio size={21} />
      {/if}
      <div>
        <strong>{CONNECTION_LABELS[trainer.connection]}</strong>
        <p>{trainer.connectionMessage}</p>
      </div>
    </div>

    {#if trainer.connection === "scanning"}
      <div class="device-dialog-scanning">
        <span class="scan-radar"><BluetoothSearching size={28} /></span>
        <strong>正在查找附近的 GAN 魔方</strong>
        <p>保持魔方唤醒并靠近设备，扫描约需 10 秒。</p>
      </div>
    {:else if trainer.devices.length > 0}
      <div class="device-dialog-list" aria-label="发现的设备">
        {#each trainer.devices as device}
          <button disabled={busy} onclick={() => void connect(device)}>
            <span class="device-dialog-icon"><Bluetooth size={19} /></span>
            <span class="device-dialog-copy">
              <strong>{device.name}</strong>
              <small>信号强度 {device.rssi ?? "—"} dBm</small>
            </span>
            <StatusPill tone={trainer.connectedDeviceName === device.name ? "success" : "info"}>
              {trainer.connectedDeviceName === device.name
                ? `已连接${trainer.battery === null ? "" : ` · ${trainer.battery}%`}`
                : busy
                  ? "连接中"
                  : "连接"}
            </StatusPill>
          </button>
        {/each}
      </div>
    {:else}
      <div class="device-dialog-empty">
        <BluetoothSearching size={30} />
        <strong>暂未发现 GAN 魔方</strong>
        <p>转动魔方使其重新广播，然后再次扫描。</p>
      </div>
    {/if}

    <footer class="device-dialog-actions">
      <button class="secondary-button" disabled={busy} onclick={close}>取消</button>
      <button class="primary-button" disabled={busy} onclick={() => void trainer.scanRealDevices()}>
        <RefreshCcw size={17} /> 重新扫描
      </button>
    </footer>
  </div>
</div>

<style>
  .device-dialog-backdrop {
    position: fixed; z-index: 90; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: 20px; background: rgb(4 7 7 / 0.72); backdrop-filter: blur(10px);
  }
  .device-dialog {
    display: grid; width: min(560px, 100%); max-height: min(760px, calc(100vh - 40px)); gap: 16px;
    overflow: auto; padding: 22px; border: 1px solid var(--color-outline); border-radius: 24px;
    color: var(--color-text); background: var(--color-surface); box-shadow: 0 28px 88px rgb(0 0 0 / 0.48);
  }
  .device-dialog-header, .device-dialog-status, .device-dialog-list > button, .device-dialog-actions { display: flex; align-items: center; }
  .device-dialog-header { justify-content: space-between; gap: 16px; }
  .device-dialog-header h2 { margin: 4px 0 0; font-size: 1.35rem; letter-spacing: -0.035em; }
  .eyebrow { color: var(--color-primary); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; }
  .dialog-close-button {
    display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; padding: 0;
    border-radius: 50%; color: var(--color-text-muted); background: var(--color-surface-highest); cursor: pointer;
  }
  .dialog-close-button:hover { color: var(--color-text); }
  .dialog-close-button:disabled { cursor: not-allowed; opacity: 0.42; }
  .device-dialog-status { gap: 11px; padding: 13px 14px; border: 1px solid var(--color-outline-soft); border-radius: 14px; background: var(--color-surface-high); }
  .device-dialog-status > :global(svg) { flex: 0 0 auto; color: var(--color-primary); }
  .device-dialog-status.tone-error > :global(svg) { color: var(--color-error); }
  .device-dialog-status.tone-warning > :global(svg) { color: var(--color-warning); }
  .device-dialog-status strong { font-size: 0.84rem; }
  .device-dialog-status p { margin: 3px 0 0; color: var(--color-text-muted); font-size: 0.74rem; line-height: 1.45; }
  .device-dialog-scanning, .device-dialog-empty {
    display: grid; min-height: 210px; place-items: center; align-content: center; gap: 10px;
    padding: 26px; border: 1px dashed var(--color-outline); border-radius: 18px;
    color: var(--color-text-muted); text-align: center;
  }
  .device-dialog-scanning strong, .device-dialog-empty strong { color: var(--color-text); }
  .device-dialog-scanning p, .device-dialog-empty p { max-width: 330px; margin: 0; font-size: 0.76rem; line-height: 1.5; }
  .device-dialog-empty > :global(svg) { color: var(--color-primary); }
  .scan-radar { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 50%; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
  .spinning, .scan-radar :global(svg) { animation: spin 1.5s linear infinite; }
  .device-dialog-list { display: grid; gap: 9px; }
  .device-dialog-list > button {
    gap: 12px; width: 100%; padding: 12px; border: 1px solid var(--color-outline-soft); border-radius: 14px;
    color: var(--color-text); background: var(--color-surface-high); text-align: left; cursor: pointer;
  }
  .device-dialog-list > button:hover { border-color: var(--color-primary); background: var(--color-surface-highest); }
  .device-dialog-list > button:disabled { cursor: wait; opacity: 0.72; }
  .device-dialog-icon { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border-radius: 11px; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 11%, transparent); }
  .device-dialog-copy { display: grid; min-width: 0; flex: 1; gap: 3px; }
  .device-dialog-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .device-dialog-copy small { color: var(--color-text-muted); font-size: 0.7rem; }
  .device-dialog-actions { justify-content: flex-end; gap: 9px; padding-top: 2px; }
  .primary-button, .secondary-button { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border-radius: 12px; font-weight: 760; cursor: pointer; }
  .primary-button { color: var(--color-on-primary); background: var(--color-primary); }
  .secondary-button { color: var(--color-text); background: var(--color-surface-highest); }
  .primary-button:disabled, .secondary-button:disabled { cursor: not-allowed; opacity: 0.45; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 599px) {
    .device-dialog-backdrop { align-items: end; padding: 0; }
    .device-dialog { width: 100%; max-height: 88vh; padding: 19px 16px 24px; border-radius: 24px 24px 0 0; }
    .device-dialog-actions > button { flex: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .spinning, .scan-radar :global(svg) { animation: none; } }
</style>
