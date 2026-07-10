import { describe, expect, it } from "vitest";
import {
  createGanV2CipherCandidates,
  deriveGanV2CipherMaterial,
  extractGanHardwareAddress,
  GanV2Cipher,
  selectGanV2Cipher,
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

  it("selects a non-default manufacturer layout from semantic GAN V4 packets", () => {
    const manufacturerData = { 1: [90, 91, 92, 0, 1, 2, 3, 4, 5] };
    const candidates = createGanV2CipherCandidates(manufacturerData);
    const actualCipher = new GanV2Cipher(
      deriveGanV2CipherMaterial(Uint8Array.from([2, 1, 0, 92, 91, 90])),
    );
    const packets = Array.from({ length: 8 }, (_, index) => {
      const packet = new Uint8Array(20);
      packet.set([0x20 + (index % 5), 0x0a]);
      return actualCipher.encode(packet);
    });

    const selection = selectGanV2Cipher(candidates, packets);
    expect(selection.credible).toBe(true);
    expect(selection.semanticScore).toBe(8);
    expect(selection.cipher.decode(packets[0]).slice(0, 2)).toEqual(Uint8Array.from([0x20, 0x0a]));
  });
});
