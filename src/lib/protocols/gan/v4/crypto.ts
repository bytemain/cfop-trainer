import * as aesjs from "aes-js";

const GAN_V2_BASE_KEY = new Uint8Array([
  1, 2, 66, 40, 49, 145, 22, 7, 32, 5, 24, 84, 66, 17, 18, 83,
]);

const GAN_V2_BASE_IV = new Uint8Array([
  17, 3, 50, 40, 33, 1, 118, 39, 32, 149, 120, 20, 50, 18, 2, 67,
]);

export interface GanCipherMaterial {
  key: Uint8Array;
  iv: Uint8Array;
}

export interface GanCipherCandidate {
  cipher: GanV2Cipher;
  preferred: boolean;
}

export interface GanCipherSelection {
  cipher: GanV2Cipher;
  candidateCount: number;
  sampleCount: number;
  semanticScore: number;
  credible: boolean;
}

const GAN_V4_KNOWN_MODES = new Set([
  0x01, 0xd1, 0xec, 0xed, 0xef, 0xf5, 0xf6, 0xfa, 0xfc, 0xfd, 0xfe, 0xff,
  0x10, 0x20, 0x21, 0x22, 0x23, 0x24,
]);

/**
 * GAN advertisements use company identifiers whose low byte is 0x01. The
 * final six payload bytes encode the Bluetooth hardware address in reverse.
 * This function deliberately returns only the address bytes required by the
 * cipher and callers must not persist or log them.
 */
export function extractGanHardwareAddress(
  manufacturerData: Record<number, number[]> | undefined,
): Uint8Array | null {
  if (!manufacturerData) return null;

  for (const [companyId, payload] of Object.entries(manufacturerData)) {
    if ((Number(companyId) & 0xff) !== 0x01 || payload.length < 6) continue;
    return Uint8Array.from(payload.slice(-6).reverse());
  }

  return null;
}

export function deriveGanV2CipherMaterial(hardwareAddress: Uint8Array): GanCipherMaterial {
  if (hardwareAddress.length !== 6) {
    throw new Error("GAN cipher derivation requires a six-byte hardware address");
  }

  return deriveGanV2CipherMaterialFromSalt(hardwareAddress.slice().reverse());
}

function deriveGanV2CipherMaterialFromSalt(salt: Uint8Array): GanCipherMaterial {
  if (salt.length !== 6) {
    throw new Error("GAN cipher derivation requires a six-byte salt");
  }

  const key = GAN_V2_BASE_KEY.slice();
  const iv = GAN_V2_BASE_IV.slice();
  for (let index = 0; index < 6; index += 1) {
    key[index] = (key[index] + salt[index]) % 255;
    iv[index] = (iv[index] + salt[index]) % 255;
  }

  return { key, iv };
}

/**
 * GAN generations and firmware revisions place the six-byte cipher salt at
 * different offsets and in different byte orders. Keep every plausible
 * in-memory candidate, then select one from the semantic notification stream.
 * Candidate material must never be logged or persisted.
 */
export function createGanV2CipherCandidates(
  manufacturerData: Record<number, number[]> | undefined,
): GanCipherCandidate[] {
  if (!manufacturerData) return [];

  const candidates: GanCipherCandidate[] = [];
  const seen = new Set<string>();
  for (const [companyId, payload] of Object.entries(manufacturerData)) {
    if ((Number(companyId) & 0xff) !== 0x01 || payload.length < 6) continue;

    for (let offset = 0; offset <= payload.length - 6; offset += 1) {
      const forward = Uint8Array.from(payload.slice(offset, offset + 6));
      const variants = [forward, forward.slice().reverse()];
      for (const [variantIndex, salt] of variants.entries()) {
        const identity = [...salt].join(",");
        if (seen.has(identity)) continue;
        seen.add(identity);
        candidates.push({
          cipher: new GanV2Cipher(deriveGanV2CipherMaterialFromSalt(salt)),
          preferred: offset === payload.length - 6 && variantIndex === 0,
        });
      }
    }
  }
  return candidates;
}

function semanticScore(cipher: GanV2Cipher, encryptedPackets: Uint8Array[]): number {
  let score = 0;
  for (const encrypted of encryptedPackets) {
    if (encrypted.length < 16) continue;
    try {
      const decoded = cipher.decode(encrypted);
      if (GAN_V4_KNOWN_MODES.has(decoded[0]) && decoded[1] <= 20) score += 1;
    } catch {
      // Truncated or otherwise invalid candidates simply contribute no score.
    }
  }
  return score;
}

export function selectGanV2Cipher(
  candidates: GanCipherCandidate[],
  encryptedPackets: Uint8Array[],
): GanCipherSelection {
  if (candidates.length === 0) throw new Error("No GAN cipher candidates are available");

  const usablePackets = encryptedPackets.filter((packet) => packet.length >= 16);
  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = semanticScore(candidate.cipher, usablePackets);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  const credible =
    usablePackets.length >= 3 &&
    bestScore >= 2 &&
    bestScore * 2 >= usablePackets.length;
  const selected = credible
    ? best
    : candidates.find((candidate) => candidate.preferred) ?? candidates[0];

  return {
    cipher: selected.cipher,
    candidateCount: candidates.length,
    sampleCount: usablePackets.length,
    semanticScore: credible ? bestScore : semanticScore(selected.cipher, usablePackets),
    credible,
  };
}

export class GanV2Cipher {
  private readonly aes: aesjs.ModeOfOperation.ModeOfOperationECB;

  constructor(private readonly material: GanCipherMaterial) {
    this.aes = new aesjs.ModeOfOperation.ecb(material.key);
  }

  encode(packet: Uint8Array): Uint8Array {
    this.assertPacket(packet);
    const encoded = packet.slice();

    for (let index = 0; index < 16; index += 1) encoded[index] ^= this.material.iv[index];
    encoded.set(this.aes.encrypt(encoded.slice(0, 16)), 0);

    if (encoded.length > 16) {
      const offset = encoded.length - 16;
      const finalBlock = encoded.slice(offset);
      for (let index = 0; index < 16; index += 1) finalBlock[index] ^= this.material.iv[index];
      encoded.set(this.aes.encrypt(finalBlock), offset);
    }

    return encoded;
  }

  decode(packet: Uint8Array): Uint8Array {
    this.assertPacket(packet);
    const decoded = packet.slice();

    if (decoded.length > 16) {
      const offset = decoded.length - 16;
      const finalBlock = this.aes.decrypt(decoded.slice(offset));
      for (let index = 0; index < 16; index += 1) finalBlock[index] ^= this.material.iv[index];
      decoded.set(finalBlock, offset);
    }

    decoded.set(this.aes.decrypt(decoded.slice(0, 16)), 0);
    for (let index = 0; index < 16; index += 1) decoded[index] ^= this.material.iv[index];
    return decoded;
  }

  private assertPacket(packet: Uint8Array): void {
    if (packet.length < 16) throw new Error(`GAN encrypted packet is too short: ${packet.length}`);
  }
}
