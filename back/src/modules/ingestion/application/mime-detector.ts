import type { SupportedFileType } from "../domain/types";

const UTF8_BOM = [0xef, 0xbb, 0xbf];

export class MimeDetector {
  static detect(bytes: Buffer): SupportedFileType | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length >= png.length && png.every((value, index) => bytes[index] === value)) {
      return "image/png";
    }
    if (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }
    if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "%PDF") {
      return "application/pdf";
    }
    return null;
  }

  static looksLikeText(bytes: Buffer): boolean {
    const probe = bytes.length >= 64 ? bytes.subarray(0, 64) : bytes;
    if (probe.includes(0x00)) {
      return false;
    }
    if (UTF8_BOM.every((value, index) => probe[index] === value)) {
      return true;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      // A fixed-size signature probe can end inside a multibyte UTF-8 character.
      // Full-file decoding downstream still performs the final strict validation.
      decoder.decode(probe, { stream: true });
      return true;
    } catch {
      return false;
    }
  }
}
