<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { ArrowLeft, Bluetooth, Radio } from "lucide-svelte";
  import SignalCalibrationLab from "$lib/components/SignalCalibrationLab.svelte";
  import { trainer } from "$lib/stores/trainer.svelte";

  const cubePaletteStyle = $derived(
    "--cube-white:" + trainer.stickerPalette.white + ";" +
      "--cube-yellow:" + trainer.stickerPalette.yellow + ";" +
      "--cube-red:" + trainer.stickerPalette.red + ";" +
      "--cube-orange:" + trainer.stickerPalette.orange + ";" +
      "--cube-blue:" + trainer.stickerPalette.blue + ";" +
      "--cube-green:" + trainer.stickerPalette.green + ";",
  );

  onMount(() => {
    void trainer.initialize();
  });
</script>

<svelte:head>
  <title>魔方信号采集 · CFOP Trainer</title>
  <meta name="description" content="采集智能魔方姿态、旋转轴、动作和 BLE 字段变化证据。" />
</svelte:head>

<div class="signal-route" style={cubePaletteStyle}>
  {#if trainer.connectedDeviceName && trainer.connectedProtocol}
    <SignalCalibrationLab
      standalone
      deviceModel={trainer.connectedDeviceName}
      protocol={trainer.connectedProtocol}
      cube={trainer.cube}
      orientation={trainer.gyroQuaternion}
      velocity={trainer.gyroVelocity}
      orientationSerial={trainer.gyroEventSerial}
      moveSerial={trainer.protocolMoveSerial}
      lastMove={trainer.lastProtocolMove}
      signalFrame={trainer.lastSignalFrame}
      signalFrameSerial={trainer.signalFrameSerial}
      gyroCalibration={trainer.gyroCalibration}
      onclose={() => void goto("/")}
      onsave={(profile) => trainer.saveSignalCalibrationProfile(profile)}
    />
  {:else}
    <main class="connection-required">
      <div class="icon"><Bluetooth size={34} /></div>
      <span>Signal calibration lab</span>
      <h1>先连接蓝牙魔方</h1>
      <p>信号采集页面已经打开，但当前没有可复用的实体魔方会话。返回训练页连接设备后，再进入采集实验室。</p>
      <div class="status"><Radio size={17} /> {trainer.connectionMessage}</div>
      <button onclick={() => void goto("/")}><ArrowLeft size={18} /> 返回并连接魔方</button>
    </main>
  {/if}
</div>

<style>
  .signal-route { min-height: 100vh; background: var(--color-background); }
  .connection-required {
    display: grid; min-height: 100vh; place-content: center; justify-items: center; gap: 14px;
    padding: 28px; text-align: center;
    background: radial-gradient(circle at 50% 30%, rgb(49 189 132 / 0.13), transparent 36%);
  }
  .connection-required .icon {
    display: grid; width: 72px; height: 72px; place-items: center; border-radius: 24px;
    color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  }
  .connection-required > span { color: var(--color-primary); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.6rem); letter-spacing: -0.055em; }
  p { max-width: 560px; margin: 0; color: var(--color-text-muted); line-height: 1.7; }
  .status { display: inline-flex; align-items: center; gap: 8px; margin: 7px 0; padding: 11px 14px; border-radius: 12px; color: var(--color-text-muted); background: var(--color-surface); }
  button { display: inline-flex; min-height: 46px; align-items: center; gap: 8px; padding: 0 18px; border: 0; border-radius: 12px; color: #06251a; background: var(--color-primary); font: inherit; font-weight: 780; cursor: pointer; }
</style>
