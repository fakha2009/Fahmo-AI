import { Readable } from "node:stream";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import { randomHex } from "../../shared/utils/hash";
import { OutputLanguageSchema, type DocumentType, ExplanationModeSchema, RetentionModeSchema, SourcePreviewModeSchema } from "../../validation/common";
import { InputManifestSchema, type InputManifest } from "../../validation/request/manifest";
import { IdempotencyKeySchema } from "../../validation/request/idempotency";
import type { SourceType } from "../../validation/common";
import type { AnalysisRecord } from "../../modules/analysis/application/analysis-repository";
import type { TaskRecord } from "../../modules/tasks/application/task-repository";
import { createAnalysisSseStream, encodeSseComment } from "../../modules/analysis/application/analysis-sse";
import type { RouteHandler } from "../router";
import { sendJson, sendNoContent } from "../responses";
import { parseMultipartBody, type MultipartFilePart } from "../body";
import { applySessionCookie, requireSession, resolveSession } from "../session";
import { mapAnalysisResult } from "../mappers/result";
import { messageKeyForStatus } from "./status-keys";

const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

export const listAnalysesRoute: RouteHandler = async ({ req, res, ctx, rc }) => {
  const session = await requireSession(ctx.sessions, rc);
  const url = new URL(req.url ?? "/", "http://localhost");
  const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const records = await ctx.analysisRepository.listActivePageByOwner(session.session.id, null, limit);
  sendJson({
    res,
    rc,
    body: {
      items: records.map((record) => statusResponse(record)),
      nextCursor: null,
    },
  });
};

/** Значения documentType, которые шлёт фронтенд (analyze.js). */
const FrontendDocumentTypeSchema = z
  .enum(["auto", "announcement", "work-order", "handwritten", "other"])
  .optional();

const FRONTEND_TO_BACKEND_DOCUMENT_TYPE: Readonly<Record<string, DocumentType>> = {
  announcement: "announcement",
  "work-order": "work_assignment",
  handwritten: "handwritten_note",
  other: "other",
};

function normalizeDocumentType(value: string | undefined): DocumentType | null {
  if (value === undefined || value === "auto") {
    return null;
  }
  return FRONTEND_TO_BACKEND_DOCUMENT_TYPE[value] ?? null;
}

const SettingsSchema = z
  .object({
    resultLanguage: OutputLanguageSchema.optional(),
    documentType: FrontendDocumentTypeSchema,
    explanationMode: ExplanationModeSchema.optional(),
    explanationLevel: ExplanationModeSchema.optional(),
    retentionMode: RetentionModeSchema.optional(),
    sourcePreviewMode: SourcePreviewModeSchema.optional(),
  })
  .strict()
  .passthrough();

const RemotePageSchema = z
  .object({
    id: z.string().min(1).max(100),
    sourceId: z.string().min(1).max(100).optional(),
    order: z.number().int().min(0),
    rotation: z.number().int().multipleOf(90).min(0).max(270).optional(),
    kind: z.enum(["image", "pdf", "text"]),
    sourcePage: z.number().int().min(1).optional(),
  })
  .strict()
  .passthrough();

const RemotePagesSchema = z.array(RemotePageSchema).min(1).max(100);

const RemoteSourcesSchema = z.array(z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(["image", "pdf", "text"]),
}).strict()).min(1).max(100);

export interface UploadUnit {
  filename: string;
  contentType: string;
  buffer: Buffer;
  kind: "image" | "pdf" | "text";
  sourceId: string | null;
}

export const createAnalysisRoute: RouteHandler = async ({ req, res, ctx, rc }) => {
  ctx.rateLimiters.createAnalysis.consume(rc.clientIp || "unknown");

  const resolved = await resolveSession(ctx.sessions, rc);
  if (resolved.issued) {
    applySessionCookie(res, resolved.token);
  }
  const actorKey = resolved.session.id;

  const multipart = await parseMultipartBody(req, ctx.config.MAX_UPLOAD_BYTES * 2 + 1024 * 1024);

  const idempotencyKeyHeader = req.headers["idempotency-key"];
  const idempotencyKeyValue = Array.isArray(idempotencyKeyHeader) ? idempotencyKeyHeader[0] : idempotencyKeyHeader;
  const parsedKey = idempotencyKeyValue !== undefined ? IdempotencyKeySchema.safeParse(idempotencyKeyValue) : null;
  if (idempotencyKeyValue !== undefined && !parsedKey?.success) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректный Idempotency-Key" });
  }
  const idempotencyKey = parsedKey?.success ? parsedKey.data : null;

  const settingsText = multipart.fields.get("settings") ?? "{}";
  let settingsParsed;
  try {
    settingsParsed = SettingsSchema.safeParse(JSON.parse(settingsText));
  } catch {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректные настройки анализа" });
  }
  if (!settingsParsed.success) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректные настройки анализа" });
  }
  const pagesText = multipart.fields.get("pages");
  if (pagesText === undefined) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Отсутствует поле pages" });
  }
  let pages;
  try {
    pages = RemotePagesSchema.parse(JSON.parse(pagesText));
  } catch {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректное поле pages" });
  }

  const sourcesText = multipart.fields.get("sources");
  let sources: z.infer<typeof RemoteSourcesSchema> | null = null;
  if (sourcesText !== undefined) {
    try {
      sources = RemoteSourcesSchema.parse(JSON.parse(sourcesText));
    } catch {
      throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректное поле sources" });
    }
  }

  const uploads = buildUploads(multipart.files, sources);
  if (uploads.length === 0) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Запрос не содержит файлов" });
  }
  const manifest = buildManifest(pages, uploads);

  const requestHash = JSON.stringify({
    files: uploads.map((upload) => `${upload.kind}:${upload.filename}:${upload.buffer.length}`),
    settings: settingsParsed.data,
    pages,
  });

  if (idempotencyKey !== null) {
    const outcome = await ctx.idempotency.acquire(
      actorKey,
      idempotencyKey,
      "POST /api/v1/analyses",
      requestHash
    );
    if (!outcome.isNew) {
      if (outcome.record !== null && outcome.record.responseStatus > 0 && outcome.record.responseBody !== null) {
        sendJson({ res, rc, status: outcome.record.responseStatus, body: outcome.record.responseBody });
        return;
      }
      sendJson({ res, rc, status: 202, body: { status: "queued", message: "Запрос уже выполняется" } });
      return;
    }
  }

  const sourceType = deriveSourceType(uploads);

  const { analysisId } = await ctx.pipeline.createFromRequest({
    sessionId: actorKey,
    userId: null,
    sourceType,
    documentType: normalizeDocumentType(settingsParsed.data.documentType) ?? "other",
    outputLanguage: settingsParsed.data.resultLanguage ?? "ru",
    explanationMode: settingsParsed.data.explanationMode ?? settingsParsed.data.explanationLevel ?? "standard",
    retentionMode: settingsParsed.data.retentionMode ?? "temporary",
    sourcePreviewMode: settingsParsed.data.sourcePreviewMode ?? "temporary",
    expiresAt: null,
    idempotencyKey,
    manifest,
  });

  const stagingKeys: string[] = [];
  try {
    for (const upload of uploads) {
      const key = `staging/uploads/${randomHex()}`;
      await ctx.storage.put({
        key,
        contentType: upload.contentType,
        body: Readable.from(upload.buffer),
        expiresAt: new Date(Date.now() + STAGING_TTL_MS),
      });
      stagingKeys.push(key);
    }
    await ctx.inputRepository.saveForAnalysis(
      analysisId,
      uploads.map((upload, index) => ({
        index,
        originalName: upload.filename,
        mimeType: upload.contentType,
        sizeBytes: upload.buffer.length,
        stagingKey: stagingKeys[index] ?? null,
        textContent: upload.kind === "text" ? upload.buffer.toString("utf8") : null,
      }))
    );
  } catch (error) {
    for (const key of stagingKeys) {
      await ctx.storage.delete(key).catch(() => undefined);
    }
    throw error;
  }

  const body = {
    id: analysisId,
    analysisId,
    status: "queued",
    stage: "queued",
    progress: 0,
    messageKey: "events.analysis.stage.queued",
    updatedAt: new Date().toISOString(),
    result: null,
    sessionToken: resolved.token,
  };

  if (idempotencyKey !== null) {
    await ctx.idempotency.complete(actorKey, idempotencyKey, 201, body);
  }

  res.setHeader('X-Session-Token', resolved.token);
  sendJson({ res, rc, status: 201, body });
};

export const getAnalysisRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const record = await ctx.analysisRepository.get(params.analysisId ?? "");
  if (record === null || !belongsTo(record, session.session.id)) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  const tasks = record.result === null ? [] : await ctx.taskRepository.listByAnalysis(record.id);
  sendJson({ res, rc, body: statusResponse(record, tasks) });
};

export const cancelAnalysisRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const record = await ctx.analysisRepository.get(params.analysisId ?? "");
  if (record === null || !belongsTo(record, session.session.id)) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  const cancelled = await ctx.analysisController.cancel(record.id, "user");
  if (cancelled) {
    sendNoContent({ res, rc });
    return;
  }

  // Completion may win the race with cancellation. Return the latest state so
  // clients preserve the valid result instead of handling an expected 409.
  const current = await ctx.analysisRepository.get(record.id);
  if (current === null || !belongsTo(current, session.session.id)) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  const tasks = current.result === null ? [] : await ctx.taskRepository.listByAnalysis(current.id);
  sendJson({ res, rc, body: statusResponse(current, tasks) });
};

export const deleteAnalysisRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const removed = await ctx.analysisRepository.softDeleteOwned(params.analysisId ?? "", session.session.id);
  if (!removed) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  sendNoContent({ res, rc });
};

export const analysisEventsRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const analysisId = params.analysisId ?? "";
  const record = await ctx.analysisRepository.get(analysisId);
  if (record === null || !belongsTo(record, session.session.id)) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }

  const lastEventIdHeader = req.headers["last-event-id"];
  const lastEventIdValue = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;
  const lastEventId = lastEventIdValue !== undefined && /^[0-9]+$/.test(lastEventIdValue)
    ? Number(lastEventIdValue)
    : null;

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (session.token) {
    res.setHeader("X-Session-Token", session.token);
  }
  res.flushHeaders();
  res.write(encodeSseComment("connected"));

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const stream = createAnalysisSseStream({
      analysisId,
      lastEventId,
      store: ctx.eventStore,
      hub: ctx.hub,
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      if (!res.writableEnded) {
        res.write(chunk);
      }
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
};

function buildUploads(parts: MultipartFilePart[], sources: z.infer<typeof RemoteSourcesSchema> | null): UploadUnit[] {
  const uploads: UploadUnit[] = [];
  for (const part of parts) {
    if (part.name !== "files" && part.name !== "texts") {
      continue;
    }
    const kind = part.name === "texts"
      ? "text"
      : part.contentType.toLowerCase().includes("pdf")
        ? "pdf"
        : "image";
    uploads.push({
      filename: kind === "text"
        ? normalizeTextUploadFilename(part.filename, uploads.length)
        : part.filename || `file_${uploads.length + 1}`,
      contentType: part.contentType,
      buffer: part.buffer,
      kind,
      sourceId: sources?.[uploads.length]?.id ?? null,
    });
  }
  if (sources !== null && sources.length !== uploads.length) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Количество источников не соответствует файлам" });
  }
  return uploads;
}

export function normalizeTextUploadFilename(filename: string, index = 0): string {
  const normalized = filename.trim();
  if (normalized.length === 0) {
    return `document_${index + 1}.txt`;
  }
  return /\.txt$/iu.test(normalized) ? normalized : `${normalized}.txt`;
}

/**
 * Маппит страницы фронта на файлы в порядке частей multipart:
 * image-страница → следующий image-файл, text-страница → следующий text-файл,
 * pdf-страница → следующий pdf-файл (первая страница файла) или тот же файл.
 */
export function buildManifest(pages: z.infer<typeof RemotePagesSchema>, uploads: UploadUnit[]): InputManifest {
  if (pages.every((page) => page.sourceId !== undefined) && uploads.every((upload) => upload.sourceId !== null)) {
    return buildManifestBySourceId(pages, uploads);
  }

  const imageQueue = uploads.map((upload, index) => ({ upload, index })).filter((item) => item.upload.kind === "image");
  const textQueue = uploads.map((upload, index) => ({ upload, index })).filter((item) => item.upload.kind === "text");
  const pdfQueue = uploads.map((upload, index) => ({ upload, index })).filter((item) => item.upload.kind === "pdf");

  const items = [];
  let currentPdf: { upload: UploadUnit; index: number } | null = null;

  for (const page of [...pages].sort((a, b) => a.order - b.order)) {
    if (page.kind === "image") {
      const next = imageQueue.shift();
      if (next === undefined) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Страница изображения не соответствует файлу",
          params: { pageId: page.id },
        });
      }
      items.push({
        clientPageId: page.id,
        fileIndex: next.index,
        sourcePageNumber: page.sourcePage ?? 1,
        finalOrder: page.order,
        rotation: page.rotation ?? 0,
        crop: null,
      });
    } else if (page.kind === "pdf") {
      if (currentPdf === null || (page.sourcePage ?? 1) === 1) {
        const next = pdfQueue.shift();
        if (next === undefined) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            message: "Страница PDF не соответствует файлу",
            params: { pageId: page.id },
          });
        }
        currentPdf = next;
      }
      items.push({
        clientPageId: page.id,
        fileIndex: currentPdf.index,
        sourcePageNumber: page.sourcePage ?? 1,
        finalOrder: page.order,
        rotation: page.rotation ?? 0,
        crop: null,
      });
    } else {
      const next = textQueue.shift();
      if (next === undefined) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Текстовая страница не соответствует файлу",
          params: { pageId: page.id },
        });
      }
      items.push({
        clientPageId: page.id,
        fileIndex: next.index,
        sourcePageNumber: page.sourcePage ?? 1,
        finalOrder: page.order,
        rotation: page.rotation ?? 0,
        crop: null,
      });
    }
  }

  if (imageQueue.length > 0 || textQueue.length > 0 || pdfQueue.length > 0) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "Часть файлов не привязана к страницам",
    });
  }

  const parsed = InputManifestSchema.safeParse(items);
  if (!parsed.success) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "Некорректный манифест страниц",
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

function buildManifestBySourceId(pages: z.infer<typeof RemotePagesSchema>, uploads: UploadUnit[]): InputManifest {
  const uploadBySourceId = new Map(uploads.map((upload, index) => [upload.sourceId, { upload, index }]));
  const usedUploadIndexes = new Set<number>();
  const items = [...pages].sort((a, b) => a.order - b.order).map((page) => {
    const source = uploadBySourceId.get(page.sourceId ?? null);
    if (source === undefined || source.upload.kind !== page.kind) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Страница не соответствует источнику",
        params: { pageId: page.id, sourceId: page.sourceId ?? "" },
      });
    }
    usedUploadIndexes.add(source.index);
    return {
      clientPageId: page.id,
      fileIndex: source.index,
      sourcePageNumber: page.sourcePage ?? 1,
      finalOrder: page.order,
      rotation: page.rotation ?? 0,
      crop: null,
    };
  });

  if (usedUploadIndexes.size !== uploads.length) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Часть файлов не привязана к страницам" });
  }
  const parsed = InputManifestSchema.safeParse(items);
  if (!parsed.success) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректный манифест страниц", details: parsed.error.issues });
  }
  return parsed.data;
}

function deriveSourceType(uploads: UploadUnit[]): SourceType {
  if (uploads.some((upload) => upload.kind === "pdf")) {
    return "pdf";
  }
  const imageCount = uploads.filter((upload) => upload.kind === "image").length;
  if (imageCount > 1) {
    return "multi_image";
  }
  if (imageCount === 1) {
    return "image";
  }
  return "text";
}

export function belongsTo(record: AnalysisRecord, sessionId: string): boolean {
  if (record.sessionId !== null) {
    return record.sessionId === sessionId;
  }
  return false;
}

export function statusResponse(record: AnalysisRecord, tasks: TaskRecord[] = []) {
  const messageKey = messageKeyForStatus(record);
  return {
    analysisId: record.id,
    status: record.status,
    stage: record.stage,
    progress: record.progress ?? 0,
    messageKey,
    updatedAt: record.updatedAt.toISOString(),
    result: record.status === "completed" || record.status === "needs_clarification"
      ? mapAnalysisResult(record, tasks)
      : undefined,
    error: record.status === "failed"
      ? { code: record.errorCode ?? "INTERNAL_ERROR", messageKey }
      : undefined,
  };
}
