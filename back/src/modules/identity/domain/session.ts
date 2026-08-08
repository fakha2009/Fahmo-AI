import { randomBytes } from "node:crypto";
import { sha256Hex } from "../../../shared/utils/hash";

export const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

export function isSessionTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(token) && token.length >= 16 && token.length <= 128;
}
