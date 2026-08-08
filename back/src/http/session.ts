import type { ServerResponse } from "node:http";
import { AppError } from "../shared/errors";
import type { SessionRecord } from "../modules/identity/application/session-repository";
import type { SessionService } from "../modules/identity/application/session-service";
import type { RequestContext } from "./request-context";

export interface ResolvedSession {
  session: SessionRecord;
  token: string;
  /** true — сессия создана в этом запросе (нужно Set-Cookie). */
  issued: boolean;
}

const SESSION_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;
const appUrl = String(process.env.APP_URL ?? "").toLowerCase();
const SESSION_COOKIE_SECURE =
  process.env.NODE_ENV === "production" ||
  appUrl.startsWith("https://");
const SESSION_COOKIE_SAMESITE = SESSION_COOKIE_SECURE ? "None" : "Lax";

export async function resolveSession(
  sessions: SessionService,
  rc: RequestContext
): Promise<ResolvedSession> {
  if (rc.sessionToken !== null) {
    const session = await sessions.validate(rc.sessionToken);
    return { session, token: rc.sessionToken, issued: false };
  }
  const issued = await sessions.create();
  return { session: issued.session, token: issued.token, issued: true };
}

/** Авторизует запрос: сессия обязательна (из куки или заголовка). */
export async function requireSession(
  sessions: SessionService,
  rc: RequestContext
): Promise<ResolvedSession> {
  if (rc.sessionToken === null) {
    throw new AppError({ code: "UNAUTHORIZED", message: "Требуется сессия" });
  }
  const session = await sessions.validate(rc.sessionToken);
  return { session, token: rc.sessionToken, issued: false };
}

export function applySessionCookie(res: ServerResponse, token: string): void {
  const parts = [
    `fahmo_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${SESSION_COOKIE_SAMESITE}`,
    `Max-Age=${SESSION_COOKIE_TTL_SECONDS}`,
  ];
  if (SESSION_COOKIE_SECURE) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}
