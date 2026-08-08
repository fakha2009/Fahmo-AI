import { Prisma, type ExportJob as PrismaExportJob } from "@prisma/client";
import { prisma } from "../client";
import { exportJobStatus, exportKind } from "../mappers/enums";
import type {
  ExportJobCreateInput,
  ExportJobRecord,
  ExportJobRepository,
} from "../../modules/exports/application/export-repository";

export class PrismaExportJobRepository implements ExportJobRepository {
  async create(input: ExportJobCreateInput): Promise<ExportJobRecord> {
    const row = await prisma.exportJob.create({
      data: {
        id: input.id,
        kind: exportKind.toPrisma(input.kind),
        analysis_id: input.analysisId,
        session_id: input.sessionId,
        user_id: input.userId,
        payload: input.payload === null ? Prisma.DbNull : (input.payload as Prisma.InputJsonValue),
        expires_at: input.expiresAt,
      },
    });
    return exportJobToRecord(row);
  }

  async get(id: string): Promise<ExportJobRecord | null> {
    const row = await prisma.exportJob.findUnique({ where: { id } });
    return row === null ? null : exportJobToRecord(row);
  }

  async listForOwner(
    sessionId: string | null,
    userId: string | null,
    limit: number
  ): Promise<ExportJobRecord[]> {
    const where =
      sessionId !== null ? { session_id: sessionId } : userId !== null ? { user_id: userId } : {};
    const rows = await prisma.exportJob.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(exportJobToRecord);
  }

  async claimNext(now: Date): Promise<ExportJobRecord | null> {
    return prisma.$transaction(async (tx) => {
      const candidate = await tx.exportJob.findFirst({
        where: { status: "QUEUED", expires_at: { gt: now } },
        orderBy: { created_at: "asc" },
      });
      if (candidate === null) {
        return null;
      }
      const claimed = await tx.exportJob.updateMany({
        where: { id: candidate.id, status: "QUEUED" },
        data: { status: "RUNNING", updated_at: now },
      });
      if (claimed.count === 0) {
        return null;
      }
      const row = await tx.exportJob.findUnique({ where: { id: candidate.id } });
      return row === null ? null : exportJobToRecord(row);
    });
  }

  async complete(id: string, storageKey: string, now: Date): Promise<ExportJobRecord | null> {
    const updated = await prisma.exportJob.updateMany({
      where: { id, status: "RUNNING" },
      data: { status: "DONE", storage_key: storageKey, completed_at: now, updated_at: now },
    });
    if (updated.count === 0) {
      return null;
    }
    const row = await prisma.exportJob.findUnique({ where: { id } });
    return row === null ? null : exportJobToRecord(row);
  }

  async fail(id: string, errorCode: string): Promise<ExportJobRecord | null> {
    const updated = await prisma.exportJob.updateMany({
      where: { id, status: "RUNNING" },
      data: { status: "FAILED", error_code: errorCode, updated_at: new Date() },
    });
    if (updated.count === 0) {
      return null;
    }
    const row = await prisma.exportJob.findUnique({ where: { id } });
    return row === null ? null : exportJobToRecord(row);
  }

  async listExpired(now: Date): Promise<ExportJobRecord[]> {
    const rows = await prisma.exportJob.findMany({
      where: {
        status: { in: ["DONE", "FAILED"] },
        expires_at: { lt: now },
      },
      orderBy: { expires_at: "asc" },
    });
    return rows.map(exportJobToRecord);
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await prisma.exportJob.deleteMany({
      where: {
        OR: [
          { status: "DONE", expires_at: { lt: now } },
          { status: "FAILED", expires_at: { lt: now } },
          { status: "QUEUED", expires_at: { lt: now } },
        ],
      },
    });
    return result.count;
  }
}

export function exportJobToRecord(row: PrismaExportJob): ExportJobRecord {
  return {
    id: row.id,
    kind: exportKind.fromPrisma(row.kind),
    status: exportJobStatus.fromPrisma(row.status),
    analysisId: row.analysis_id,
    sessionId: row.session_id,
    userId: row.user_id,
    storageKey: row.storage_key,
    payload: row.payload,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at ?? row.created_at,
  };
}
