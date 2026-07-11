import { describe, expect, it } from "vitest";
import { CubeClock } from "./cubeClock";

describe("CubeClock", () => {
  it("uses device time for spacing despite BLE receive jitter", () => {
    const clock = new CubeClock();
    const first = clock.observe(1_000, 10_100);
    const second = clock.observe(1_120, 10_400);
    expect(second.cubeTime - first.cubeTime).toBe(120);
    expect(second.estimatedHostTime - first.estimatedHostTime).toBeLessThan(130);
  });

  it("unwraps uint32 rollover", () => {
    const clock = new CubeClock();
    const first = clock.observe(0xffff_fff0, 20_000);
    const second = clock.observe(0x20, 20_048);
    expect(second.cubeTime - first.cubeTime).toBe(48);
    expect(second.reset).toBe(false);
  });

  it("reports a firmware clock reset", () => {
    const clock = new CubeClock();
    clock.observe(50_000, 80_000);
    const reset = clock.observe(1_000, 81_000);
    expect(reset.reset).toBe(true);
    expect(reset.cubeTime).toBe(1_000);
  });
});
