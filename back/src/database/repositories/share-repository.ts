import type { Prisma, AnalysisShare } from "@prisma/client";
import { prisma } from "../client";
import type {
  ShareCreateInput,
  ShareRepository,
} from "../../modules/shares/application/share-repository";
import type { ShareRecord } from "../../modules/shares/domain/share";

export class PrismaShareRepository implements ShareRepository {
  async create(input: ShareCreateInput): Promise<ShareRecord> {
    const row = await prisma.analysisShare.create({
      data: {
        id: input.id,
        analysis_id: input.analysisId,
        token_hash: input.tokenHash,
        snapshot: input.snapshot as Prisma.InputJsonValue,
        expires_at: input.expiresAt,
        created_at: input.createdAt,
      },
    });
    return shareToRecord(row);
  }

  async get(id: string): Promise<ShareRecord | null> {
    const row = await prisma.analysisShare.findUnique({ where: { id } });
    return row === null ? null : shareToRecord(row);
  }

  async getByTokenHash(tokenHash: string): Promise<ShareRecord | null> {
    const row = await prisma.analysisShare.findUnique({ where: { token_hash: tokenHash } });
    return row === null ? null : shareToRecord(row);
  }

  async incrementViewCount(id: string, at: Date): Promise<void> {
    await prisma.analysisShare.update({
      where: { id },
      data: {
        view_count: { increment: 1 },
        last_viewed_at: at,
      },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await prisma.analysisShare.update({
      where: { id },
      data: { revoked_at: at },
    });
  }

  async listByAnalysisId(analysisId: string): Promise<ShareRecord[]> {
    const rows = await prisma.analysisShare.findMany({
      where: { analysis_id: analysisId },
      orderBy: { created_at: "desc" },
    });
    return rows.map(shareToRecord);
  }

  async deleteByAnalysisId(analysisId: string): Promise<void> {
    await prisma.analysisShare.deleteMany({ where: { analysis_id: analysisId } });
  }
}

function shareToRecord(row: AnalysisShare): ShareRecord {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    tokenHash: row.token_hash,
    snapshot: row.snapshot as unknown as ShareRecord["snapshot"],
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count,
  };
}
