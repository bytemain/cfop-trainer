import { describe, expect, it } from "vitest";
import {
  deriveGanV2CipherMaterial,
  extractGanHardwareAddress,
  GanV2Cipher,
} from "./crypto";

describe("GAN V2/V4 encryption", () => {
  it("derives the address from GAN manufacturer data without exposing the company id", () => {
    expect(
      [...(extractGanHardwareAddress({ 1: [90, 91, 92, 0, 1, 2, 3, 4, 5] }) ?? [])],
    ).toEqual([5, 4, 3, 2, 1, 0]);
    expect(extractGanHardwareAddress({ 2: [0, 1, 2, 3, 4, 5] })).toBeNull();
  });

  it("matches an independently generated AES overlap fixture", () => {
    const material = deriveGanV2CipherMaterial(Uint8Array.from([0, 1, 2, 3, 4, 5]));
    expect([...material.key.slice(0, 6)]).toEqual([6, 6, 69, 42, 50, 145]);

    const cipher = new GanV2Cipher(material);
    const plain = Uint8Array.from({ length: 20 }, (_, index) => index);
    const encoded = cipher.encode(plain);
    expect([...encoded]).toEqual([
      62, 12, 109, 97, 34, 161, 143, 9, 127, 149,
      24, 176, 24, 175, 162, 188, 123, 55, 213, 79,
    ]);
    expect(cipher.decode(encoded)).toEqual(plain);
  });
});
