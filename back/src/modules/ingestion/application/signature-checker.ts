import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import type { SupportedFileType } from "../domain/types";
import { MimeDetector } from "./mime-detector";

export const PROBE_BYTES = 64;

async function readUpTo(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    total += buffer.length;
    if (total >= maxBytes) {
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

export interface ProbeResult {
  stream: Readable;
  firstBytes: Buffer;
}

export class SignatureChecker {
  static async probe(stream: Readable): Promise<ProbeResult> {
    const downstream = new PassThrough();
    const probeStream = new PassThrough();
    stream.pipe(downstream);
    stream.pipe(probeStream);
    const firstBytes = await readUpTo(probeStream, PROBE_BYTES);
    probeStream.destroy();
    return { stream: downstream, firstBytes };
  }

  static check(firstBytes: Buffer): SupportedFileType | null {
    return MimeDetector.detect(firstBytes);
  }
}
