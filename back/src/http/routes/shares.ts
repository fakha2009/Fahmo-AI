import { AppError } from "../../shared/errors";
import type { ShareRecord } from "../../modules/shares/domain/share";
import type { ShareSnapshot } from "../../modules/shares/domain/share";
import type { RouteHandler } from "../router";
import { sendJson } from "../responses";
import { requireSession } from "../session";

export const createShareRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const analysisId = params.analysisId ?? "";
  const analysis = await ctx.analysisRepository.get(analysisId);
  if (analysis === null || analysis.sessionId !== session.session.id) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  const { share, token } = await ctx.shareService.create(analysisId, null);
  sendJson({
    res,
    rc,
    status: 201,
    body: {
      id: share.id,
      shareId: share.id,
      token,
      url: `${ctx.config.FRONTEND_ORIGIN ?? ctx.config.APP_URL}/shared/${token}`,
      createdAt: share.createdAt.toISOString(),
      expiresAt: share.expiresAt?.toISOString() ?? null,
    },
  });
};

export const revokeShareRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const analysisId = params.analysisId ?? "";
  const shareId = params.shareId ?? "";
  const analysis = await ctx.analysisRepository.get(analysisId);
  if (analysis === null || analysis.sessionId !== session.session.id) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  const shares = await ctx.shareService.listByAnalysis(analysisId);
  if (!shares.some((share) => share.id === shareId)) {
    throw new AppError({ code: "NOT_FOUND", message: "Ссылка не найдена" });
  }
  await ctx.shareService.revoke(shareId);
  sendJson({ res, rc, body: { ok: true } });
};

export const publicShareRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const share = await ctx.shareService.getPublicShare(params.token ?? "");
  sendJson({ res, rc, body: shareToResponse(share) });
};

function shareToResponse(share: ShareRecord) {
  return {
    id: share.id,
    analysisId: share.analysisId,
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt?.toISOString() ?? null,
    viewCount: share.viewCount,
    result: publicResult(share.snapshot, share.analysisId, share.createdAt),
  };
}

function publicResult(result: ShareSnapshot, analysisId: string, createdAt: Date) {
  return {
    analysisId,
    title: result.title,
    documentType: result.documentType,
    resultLanguage: result.outputLanguage,
    createdAt: createdAt.toISOString(),
    summary: { standard: result.summary, simple: result.simpleExplanation },
    tasks: result.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      simpleTitle: task.simpleTitle,
      description: task.description ?? "",
      completed: task.status === "completed",
      priority: task.priority,
      dueDate: task.deadline?.isoDate ?? task.deadline?.isoDateTime?.slice(0, 10) ?? null,
      dueTime: task.deadline?.isoDateTime?.slice(11, 16) ?? null,
    })),
    warnings: result.warnings.map((warning, index) => ({
      id: `warning_${index}`,
      title: warning.messageKey,
      message: warning.messageKey,
      severity: warning.severity,
    })),
  };
}
