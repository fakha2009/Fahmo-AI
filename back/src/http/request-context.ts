import type { IncomingMessage } from "node:http";

export interface RequestContext {
  requestId: string;
  /** Реальный IP клиента (X-Forwarded-For при проксировании). */
  clientIp: string;
  /** Токен сессии из куки fahmo_session или заголовка X-Session-Token. */
  sessionToken: string | null;
  startedAt: number;
}

const REQUEST_ID_HEADER = "x-request-id";
const SESSION_COOKIE = "fahmo_session";
const SESSION_HEADER = "x-session-token";

export function createRequestContext(req: IncomingMessage): RequestContext {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string"
    ? forwarded.split(",")[0]?.trim() ?? ""
    : req.socket.remoteAddress ?? "";

  return {
    requestId: requestIdFrom(req),
    clientIp: ip,
    sessionToken: sessionTokenFrom(req),
    startedAt: Date.now(),
  };
}

function requestIdFrom(req: IncomingMessage): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }
  return crypto.randomUUID();
}

function sessionTokenFrom(req: IncomingMessage): string | null {
  const header = req.headers[SESSION_HEADER];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (typeof headerValue === "string" && headerValue.length > 0) {
    return headerValue;
  }
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string") {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number): string {
  const appUrl = String(process.env.APP_URL ?? "").toLowerCase();
  const secure =
    process.env.NODE_ENV === "production" ||
    appUrl.startsWith("https://") ||
    appUrl.startsWith("http://localhost") ||
    appUrl.startsWith("http://127.0.0.1");
  const sameSite = secure ? "None" : "Lax";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
