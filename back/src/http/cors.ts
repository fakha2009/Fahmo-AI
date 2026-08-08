import type { IncomingMessage, ServerResponse } from "node:http";

export interface CorsOptions {
  allowedOrigins: string[];
}

const ALLOWED_HEADERS = ["Content-Type", "X-Request-ID", "Idempotency-Key", "X-Session-Token", "If-Match"];
const ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
const EXPOSED_HEADERS = ["X-Request-ID", "X-Session-Token"];

export function applyCors(req: IncomingMessage, res: ServerResponse, options: CorsOptions): void {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) {
    return;
  }
  if (options.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS.join(", "));
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS.join(", "));
  }
}

export function isPreflight(req: IncomingMessage): boolean {
  return req.method === "OPTIONS" && req.headers["access-control-request-method"] !== undefined;
}

export function handlePreflight(res: ServerResponse): void {
  res.statusCode = 204;
  res.setHeader("Access-Control-Max-Age", "86400");
  res.end();
}

export function isTrustedRequestOrigin(req: IncomingMessage, options: CorsOptions): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    return options.allowedOrigins.includes(origin);
  }
  return req.headers["sec-fetch-site"] !== "cross-site";
}
