import { AppError } from "../../shared/errors";
import type { RouteHandler } from "../router";
import { requireSession } from "../session";

export const sourcePreviewRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const asset = await ctx.sourceAssets.getForOwner(
    params.analysisId ?? "",
    params.sourceId ?? "",
    { sessionId: session.session.id, userId: null }
  );
  if (asset === null) {
    throw new AppError({ code: "NOT_FOUND", message: "Источник не найден" });
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", asset.record.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  await new Promise<void>((resolve, reject) => {
    asset.stream.on("error", reject);
    asset.stream.on("end", resolve);
    asset.stream.pipe(res);
  });
};
