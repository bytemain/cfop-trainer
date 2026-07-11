const UINT32_RANGE = 0x1_0000_0000;

export interface CubeClockSample {
  rawTimestamp: number;
  cubeTime: number;
  hostTime: number;
  estimatedHostTime: number;
  offsetMs: number;
  reset: boolean;
}

/**
 * Expands GAN's wrapping uint32 millisecond clock and anchors it to the host
 * monotonic clock.  The device clock remains authoritative for move spacing;
 * host receive time is only an offset observation and reset detector.
 */
export class CubeClock {
  private lastRaw: number | null = null;
  private epoch = 0;
  private offsetMs: number | null = null;
  private lastCubeTime: number | null = null;

  observe(rawTimestamp: number, hostTime: number): CubeClockSample {
    const raw = rawTimestamp >>> 0;
    let reset = false;

    if (this.lastRaw !== null) {
      const rawDelta = raw - this.lastRaw;
      if (rawDelta < -0x8000_0000) {
        this.epoch += UINT32_RANGE;
      } else if (rawDelta < -2_000) {
        // A backwards jump that is not a uint32 wrap means the firmware clock
        // restarted (sleep, reboot, or a new physical BLE session).
        this.epoch = 0;
        this.offsetMs = null;
        this.lastCubeTime = null;
        reset = true;
      }
    }

    let cubeTime = this.epoch + raw;
    if (this.lastCubeTime !== null && cubeTime < this.lastCubeTime) {
      reset = true;
      this.offsetMs = null;
      cubeTime = raw;
      this.epoch = 0;
    }

    const observedOffset = hostTime - cubeTime;
    if (this.offsetMs === null || Math.abs(observedOffset - this.offsetMs) > 2_000) {
      this.offsetMs = observedOffset;
    } else {
      // BLE delivery jitter must not rewrite move spacing. A light low-pass
      // update follows slow host/device clock drift without chasing each packet.
      this.offsetMs = this.offsetMs * 0.98 + observedOffset * 0.02;
    }

    this.lastRaw = raw;
    this.lastCubeTime = cubeTime;
    return {
      rawTimestamp: raw,
      cubeTime,
      hostTime,
      estimatedHostTime: cubeTime + this.offsetMs,
      offsetMs: this.offsetMs,
      reset,
    };
  }

  reset(): void {
    this.lastRaw = null;
    this.epoch = 0;
    this.offsetMs = null;
    this.lastCubeTime = null;
  }
}
