import type { IncomingMessage } from "node:http";
import { AppError } from "../shared/errors";

const DEFAULT_BODY_LIMIT = 25 * 1024 * 1024;

export async function readBody(req: IncomingMessage, limitBytes: number = DEFAULT_BODY_LIMIT): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new AppError({ code: "FILE_TOO_LARGE", message: "Тело запроса превышает лимит" });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody<T>(req: IncomingMessage, limitBytes?: number): Promise<T> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Ожидается Content-Type: application/json" });
  }
  const raw = await readBody(req, limitBytes);
  if (raw.length === 0) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Пустое тело запроса" });
  }
  try {
    return JSON.parse(raw.toString("utf8")) as T;
  } catch (error) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "Некорректный JSON в теле запроса",
      cause: error,
    });
  }
}

export interface MultipartFilePart {
  name: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface MultipartResult {
  fields: Map<string, string>;
  files: MultipartFilePart[];
}

export async function parseMultipartBody(req: IncomingMessage, limitBytes?: number): Promise<MultipartResult> {
  const contentType = req.headers["content-type"] ?? "";
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (match === null || boundary === undefined) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Отсутствует boundary в multipart/form-data" });
  }
  const raw = await readBody(req, limitBytes);
  return parseMultipart(raw, boundary);
}

export function parseMultipart(raw: Buffer, boundary: string): MultipartResult {
  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const fields = new Map<string, string>();
  const files: MultipartFilePart[] = [];

  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(delimiter, cursor);
    if (start === -1) {
      break;
    }
    const afterDelimiter = start + delimiter.length;
    if (raw[afterDelimiter] === 0x2d && raw[afterDelimiter + 1] === 0x2d) {
      break;
    }
    if (raw[afterDelimiter] !== 0x0d || raw[afterDelimiter + 1] !== 0x0a) {
      cursor = afterDelimiter;
      continue;
    }
    const headersEnd = raw.indexOf(Buffer.from("\r\n\r\n"), afterDelimiter + 2);
    if (headersEnd === -1) {
      throw new AppError({ code: "CORRUPTED_FILE", message: "Некорректная структура multipart-запроса" });
    }
    const headerBlock = raw.subarray(afterDelimiter + 2, headersEnd).toString("utf8");
    const nextDelimiter = raw.indexOf(delimiter, headersEnd + 4);
    if (nextDelimiter === -1) {
      throw new AppError({ code: "CORRUPTED_FILE", message: "Некорректная структура multipart-запроса" });
    }
    let bodyEnd = nextDelimiter;
    if (bodyEnd >= 2 && raw[bodyEnd - 2] === 0x0d && raw[bodyEnd - 1] === 0x0a) {
      bodyEnd -= 2;
    }
    const body = raw.subarray(headersEnd + 4, bodyEnd);

    const disposition = /content-disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="((?:[^"\\]|\\.)*)")?/i.exec(headerBlock);
    if (disposition === null) {
      throw new AppError({ code: "VALIDATION_ERROR", message: "Часть multipart без Content-Disposition" });
    }
    const name = disposition[1] ?? "";
    const filename = unescapeFilename(disposition[2]);
    const mime = /content-type:\s*([^\r\n]+)/i.exec(headerBlock)?.[1]?.trim() ?? "application/octet-stream";
    if (filename !== null) {
      files.push({ name, filename, contentType: mime, buffer: Buffer.from(body) });
    } else {
      fields.set(name, body.toString("utf8"));
    }
    cursor = nextDelimiter;
  }
  return { fields, files };
}

function unescapeFilename(value: string | undefined): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
