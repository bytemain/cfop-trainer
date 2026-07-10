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

  const key = GAN_V2_BASE_KEY.slice();
  const iv = GAN_V2_BASE_IV.slice();
  for (let index = 0; index < 6; index += 1) {
    key[index] = (key[index] + hardwareAddress[5 - index]) % 255;
    iv[index] = (iv[index] + hardwareAddress[5 - index]) % 255;
  }

  return { key, iv };
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
