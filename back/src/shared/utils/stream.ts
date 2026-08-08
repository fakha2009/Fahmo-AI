import type { Readable } from "node:stream";
import { TextDecoder } from "node:util";

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function readTextValidated(stream: Readable): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  for await (const chunk of stream) {
    const decoded = decoder.decode(chunk, { stream: true });
    text += decoded;
  }
  text += decoder.decode();
  return text;
}
