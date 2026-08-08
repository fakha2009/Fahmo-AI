import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
