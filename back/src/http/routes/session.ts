import type { RouteHandler } from "../router";
import { sendJson } from "../responses";
import { applySessionCookie, resolveSession } from "../session";

export const sessionRoute: RouteHandler = async ({ res, ctx, rc }) => {
  const resolved = await resolveSession(ctx.sessions, rc);
  if (resolved.issued) {
    applySessionCookie(res, resolved.token);
  }
  res.setHeader("X-Session-Token", resolved.token);
  sendJson({
    res,
    rc,
    body: {
      status: "active",
      expiresAt: resolved.session.expiresAt.toISOString(),
    },
  });
};
