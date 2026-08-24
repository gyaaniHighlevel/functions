import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

/** AES-256-GCM, envelope base64(iv[12] ‖ authTag[16] ‖ ciphertext).
 * AAD = uid binds a ciphertext to its owner doc — copying an envelope
 * between user docs fails decryption. */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Envelope failed to decrypt (rotated key or tampered doc) — callers
 * treat the connection as revoked and force a re-connect. */
export class DecryptError extends Error {
  constructor() {
    super("Token envelope failed to decrypt.");
    this.name = "DecryptError";
  }
}

function key(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENC_KEY secret is not set.");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64-encoded.");
  }
  return buf;
}

export function encrypt(plaintext: string, aadUid: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aadUid, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(envelope: string, aadUid: string): string {
  try {
    const buf = Buffer.from(envelope, "base64");
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ct = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAAD(Buffer.from(aadUid, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    throw new DecryptError();
  }
}
