import {
  Prisma,
  AnalysisStatus as PrismaAnalysisStatusEnum,
  type AnalysisStage as PrismaAnalysisStage,
  type AnalysisStatus as PrismaAnalysisStatus,
  type DocumentType as PrismaDocumentType,
  type OutputLanguage as PrismaOutputLanguage,
  type RetentionMode as PrismaRetentionMode,
  type SourcePreviewMode as PrismaSourcePreviewMode,
  type SourceType as PrismaSourceType,
} from "@prisma/client";
import { prisma } from "../client";
import { AnalysisResultSchema } from "../../validation/ai/analysis-result";
import type {
  AnalysisCreateInput,
  AnalysisRecord,
  AnalysisRepository,
  AnalysisUpdatePatch,
  AnalysisUpdateResult,
  SaveResultInput,
} from "../../modules/analysis/application/analysis-repository";
import {
  analysisStage,
  analysisStatus,
  confidenceLevel,
  documentType,
  explanationMode,
  outputLanguage,
  retentionMode,
  sourcePreviewMode,
  sourceType,
} from "../mappers/enums";

export class PrismaAnalysisRepository implements AnalysisRepository {
  async create(input: AnalysisCreateInput): Promise<AnalysisRecord> {
    const row = await prisma.analysis.create({
      data: {
        id: input.id,
        session_id: input.sessionId,
        user_id: input.userId,
        source_type: sourceType.toPrisma(input.sourceType),
        document_type: documentType.toPrisma(input.documentType),
        output_language: outputLanguage.toPrisma(input.outputLanguage),
        explanation_mode: explanationMode.toPrisma(input.explanationMode),
        retention_mode: retentionMode.toPrisma(input.retentionMode),
        source_preview_mode: sourcePreviewMode.toPrisma(input.sourcePreviewMode),
        expires_at: input.expiresAt,
      },
    });
    return analysisToRecord(row);
  }

  async get(id: string): Promise<AnalysisRecord | null> {
    const row = await prisma.analysis.findUnique({ where: { id } });
    return row === null ? null : analysisToRecord(row);
  }

  async listByOwner(sessionId: string | null, userId: string | null): Promise<AnalysisRecord[]> {
    const where =
      sessionId !== null
        ? { session_id: sessionId }
        : userId !== null
          ? { user_id: userId }
          : {};
    const rows = await prisma.analysis.findMany({ where, orderBy: { created_at: "asc" } });
    return rows.map(analysisToRecord);
  }

  async listActivePageByOwner(
    sessionId: string | null,
    userId: string | null,
    limit: number
  ): Promise<AnalysisRecord[]> {
    const owner = sessionId !== null
      ? { session_id: sessionId }
      : userId !== null
        ? { user_id: userId }
        : { id: "__no_owner__" };
    const rows = await prisma.analysis.findMany({
      where: { ...owner, deleted_at: null },
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map(analysisToRecord);
  }

  async softDeleteOwned(id: string, sessionId: string): Promise<boolean> {
    const result = await prisma.analysis.updateMany({
      where: { id, session_id: sessionId, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    return result.count === 1;
  }

  async updateStage(
    id: string,
    stage: AnalysisRecord["stage"],
    progress: number
  ): Promise<AnalysisRecord | null> {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.analysis.findFirst({
        where: {
          id,
          status: {
            notIn: [PrismaAnalysisStatusEnum.CANCELLED, PrismaAnalysisStatusEnum.FAILED],
          },
        },
      });
      if (current === null) {
        return null;
      }
      return tx.analysis.update({
        where: { id },
        data: { stage: analysisStage.toPrisma(stage), progress },
      });
    });
    return row === null ? null : analysisToRecord(row);
  }

  async updateStatus(
    id: string,
    status: AnalysisRecord["status"],
    patch?: { errorCode?: string | null; completedAt?: Date | null }
  ): Promise<AnalysisRecord | null> {
    const row = await prisma.analysis.findUnique({ where: { id } });
    if (row === null) {
      return null;
    }
    const updated = await prisma.analysis.update({
      where: { id },
      data: {
        status: analysisStatus.toPrisma(status),
        error_code: patch?.errorCode !== undefined ? patch.errorCode : row.error_code,
        completed_at:
          patch?.completedAt !== undefined ? patch.completedAt : row.completed_at,
      },
    });
    return analysisToRecord(updated);
  }

  async saveResult(id: string, input: SaveResultInput): Promise<void> {
    await prisma.analysis.update({
      where: { id },
      data: {
        structured_result: input.result as unknown as Prisma.InputJsonValue,
        detected_languages: input.detectedLanguages,
        provider: input.provider,
        model: input.model,
        overall_confidence: confidenceLevel.toPrisma(input.overallConfidence),
        result_version: input.revision,
        revision: input.revision,
      },
    });
  }

  async updateFields(
    id: string,
    expectedRevision: number,
    patch: AnalysisUpdatePatch
  ): Promise<AnalysisUpdateResult> {
    const updated = await prisma.analysis.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        ...(patch.outputLanguage !== undefined && {
          output_language: outputLanguage.toPrisma(patch.outputLanguage),
        }),
        ...(patch.explanationMode !== undefined && {
          explanation_mode: explanationMode.toPrisma(patch.explanationMode),
        }),
        ...(patch.retentionMode !== undefined && {
          retention_mode: retentionMode.toPrisma(patch.retentionMode),
        }),
        ...(patch.sourcePreviewMode !== undefined && {
          source_preview_mode: sourcePreviewMode.toPrisma(patch.sourcePreviewMode),
        }),
        revision: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      const current = await prisma.analysis.findUnique({ where: { id } });
      if (current === null) {
        return { kind: "not_found" };
      }
      return { kind: "conflict", serverRevision: current.revision };
    }
    const row = await prisma.analysis.findUnique({ where: { id } });
    if (row === null) {
      return { kind: "not_found" };
    }
    return { kind: "ok", record: analysisToRecord(row) };
  }
}

export function analysisToRecord(row: {
  id: string;
  session_id: string | null;
  user_id: string | null;
  status: PrismaAnalysisStatus;
  stage: PrismaAnalysisStage;
  progress: number | null;
  source_type: PrismaSourceType;
  document_type: PrismaDocumentType;
  output_language: PrismaOutputLanguage;
  retention_mode: PrismaRetentionMode;
  source_preview_mode: PrismaSourcePreviewMode;
  structured_result: Prisma.JsonValue;
  detected_languages: string[];
  provider: string | null;
  model: string | null;
  error_code: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}): AnalysisRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    status: analysisStatus.fromPrisma(row.status),
    stage: analysisStage.fromPrisma(row.stage),
    progress: row.progress,
    sourceType: sourceType.fromPrisma(row.source_type),
    documentType: documentType.fromPrisma(row.document_type),
    outputLanguage: outputLanguage.fromPrisma(row.output_language),
    retentionMode: retentionMode.fromPrisma(row.retention_mode),
    sourcePreviewMode: sourcePreviewMode.fromPrisma(row.source_preview_mode),
    result:
      row.structured_result === null
        ? null
        : AnalysisResultSchema.parse(row.structured_result),
    detectedLanguages: row.detected_languages,
    provider: row.provider,
    model: row.model,
    errorCode: row.error_code,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
