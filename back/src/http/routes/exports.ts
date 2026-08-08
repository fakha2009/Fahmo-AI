import { AppError } from "../../shared/errors";
import { ExportCreateRequestSchema } from "../../validation/response/export";
import type { ExportKind } from "../../validation/common";
import type { ExportJobRecord } from "../../modules/exports/application/export-repository";
import type { IncomingMessage } from "node:http";
import type { RouteHandler } from "../router";
import { sendJson } from "../responses";
import { readJsonBody } from "../body";
import { requireSession } from "../session";

export const createExportRoute: RouteHandler = async ({ req, res, ctx, rc }) => {
  const session = await requireSession(ctx.sessions, rc);
  const body = await readJsonBodySafe(req);
  const parsed = ExportCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректный запрос экспорта" });
  }
  const job = await ctx.exportService.createJob(
    { sessionId: session.session.id, userId: null },
    parsed.data
  );
  sendJson({ res, rc, status: 201, body: jobToResponse(job) });
};

export const getExportRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const job = await ctx.exportService.getJob(
    { sessionId: session.session.id, userId: null },
    params.exportId ?? ""
  );
  if (job === null) {
    throw new AppError({ code: "NOT_FOUND", message: "Экспорт не найден" });
  }
  sendJson({ res, rc, body: jobToResponse(job) });
};

export const listExportsRoute: RouteHandler = async ({ res, ctx, rc }) => {
  const session = await requireSession(ctx.sessions, rc);
  const jobs = await ctx.exportService.listJobs(
    { sessionId: session.session.id, userId: null },
    50
  );
  sendJson({ res, rc, body: { items: jobs.map(jobToResponse) } });
};

export const downloadExportRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const { job, stream } = await ctx.exportService.artifactFor(
    { sessionId: session.session.id, userId: null },
    params.exportId ?? ""
  );
  const filename = `${job.id}.${extensionFor(job.kind)}`;
  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypeFor(job.kind));
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  });
};

async function readJsonBodySafe(req: IncomingMessage): Promise<unknown> {
  return readJsonBody(req);
}

function jobToResponse(job: ExportJobRecord) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    analysisId: job.analysisId,
    storageKey: job.storageKey,
    errorCode: job.errorCode,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt.toISOString(),
  };
}

function extensionFor(kind: ExportKind): string {
  switch (kind) {
    case "pdf":
      return "pdf";
    case "ics":
      return "ics";
    case "data":
      return "json";
  }
}

function contentTypeFor(kind: ExportKind): string {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "ics":
      return "text/calendar; charset=utf-8";
    case "data":
      return "application/json; charset=utf-8";
  }
}
