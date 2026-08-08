import type { RouteHandler } from "../router";
import { sendJson } from "../responses";

export const healthRoute: RouteHandler = async ({ res, rc }) => {
  sendJson({
    res,
    rc,
    body: { status: "ok", service: "fahmo-ai", time: new Date().toISOString() },
  });
};

export const readyRoute: RouteHandler = async ({ res, rc, ctx }) => {
  try {
    await ctx.eventStore.listForAnalysis("__probe__", 1);
    await ctx.storage.list("__probe__/");
    const providers = ctx.providerRegistry.list().map((provider) => provider.getCapabilities());
    sendJson({
      res,
      rc,
      body: {
        status: "ready",
        storage: "ok",
        database: "ok",
        ai: providers.some((provider) => provider.available) ? "available" : "not_configured",
      },
    });
  } catch (error) {
    sendJson({
      res,
      rc,
      status: 503,
      body: {
        status: "unavailable",
        storage: "unknown",
        database: "error",
        message: "Service dependencies are unavailable",
      },
    });
  }
};
