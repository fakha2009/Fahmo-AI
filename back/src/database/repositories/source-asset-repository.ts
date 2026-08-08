import { prisma } from "../client";
import type {
  SourceAssetCreateInput,
  SourceAssetRecord,
  SourceAssetRepository,
} from "../../modules/preview/application/source-asset-repository";

export class PrismaSourceAssetRepository implements SourceAssetRepository {
  async create(input: SourceAssetCreateInput): Promise<SourceAssetRecord> {
    const row = await prisma.analysisSourceAsset.create({
      data: {
        id: input.id,
        analysis_id: input.analysisId,
        client_page_id: input.clientPageId,
        input_index: input.inputIndex,
        page_number: input.pageNumber,
        storage_key: input.storageKey,
        mime_type: input.mimeType,
        width: input.width,
        height: input.height,
        sha256: input.sha256,
        expires_at: input.expiresAt,
      },
    });
    return toRecord(row);
  }

  async getById(id: string): Promise<SourceAssetRecord | null> {
    const row = await prisma.analysisSourceAsset.findUnique({ where: { id } });
    return row === null ? null : toRecord(row);
  }

  async getByAnalysisId(analysisId: string): Promise<SourceAssetRecord[]> {
    const rows = await prisma.analysisSourceAsset.findMany({
      where: { analysis_id: analysisId },
      orderBy: { input_index: "asc" },
    });
    return rows.map(toRecord);
  }

  async deleteById(id: string): Promise<void> {
    await prisma.analysisSourceAsset.delete({ where: { id } });
  }

  async listExpired(now: Date): Promise<SourceAssetRecord[]> {
    const rows = await prisma.analysisSourceAsset.findMany({
      where: { expires_at: { lte: now } },
    });
    return rows.map(toRecord);
  }
}

function toRecord(row: {
  id: string;
  analysis_id: string;
  client_page_id: string;
  input_index: number;
  page_number: number;
  storage_key: string;
  mime_type: string;
  width: number;
  height: number;
  sha256: string;
  expires_at: Date;
  created_at: Date;
}): SourceAssetRecord {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    clientPageId: row.client_page_id,
    inputIndex: row.input_index,
    pageNumber: row.page_number,
    storageKey: row.storage_key,
    mimeType: row.mime_type === "image/webp" ? "image/webp" : "image/jpeg",
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
