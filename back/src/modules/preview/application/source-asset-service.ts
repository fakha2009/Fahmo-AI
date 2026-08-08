import type { Readable } from "node:stream";
import { AppError } from "../../../shared/errors";
import { randomHex } from "../../../shared/utils/hash";
import type { StoragePort } from "../../../storage/contracts/storage-port";
import type { SourcePreviewAsset } from "../../ingestion/domain/types";
import type { AnalysisRepository } from "../../analysis/application/analysis-repository";
import type {
  SourceAssetRecord,
  SourceAssetRepository,
} from "./source-asset-repository";

export interface OwnerActor {
  sessionId: string | null;
  userId: string | null;
}

export interface SourceAssetStream {
  record: SourceAssetRecord;
  stream: Readable;
}

export class SourceAssetService {
  constructor(
    private readonly assets: SourceAssetRepository,
    private readonly analyses: AnalysisRepository,
    private readonly storage: StoragePort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async save(analysisId: string, previews: SourcePreviewAsset[]): Promise<SourceAssetRecord[]> {
    const records: SourceAssetRecord[] = [];
    for (const preview of previews) {
      const record = await this.assets.create({
        id: randomHex(16),
        analysisId,
        clientPageId: preview.clientPageId,
        inputIndex: preview.inputIndex,
        pageNumber: preview.pageNumber,
        storageKey: preview.storageKey,
        mimeType: preview.mimeType,
        width: preview.width,
        height: preview.height,
        sha256: preview.sha256,
        expiresAt: preview.expiresAt,
      });
      records.push(record);
    }
    return records;
  }

  async getForOwner(
    analysisId: string,
    sourceId: string,
    actor: OwnerActor
  ): Promise<SourceAssetStream | null> {
    if (actor.sessionId === null && actor.userId === null) {
      throw new AppError({ code: "UNAUTHORIZED" });
    }
    const analysis = await this.analyses.get(analysisId);
    if (analysis === null) {
      return null;
    }
    const owns =
      (actor.sessionId !== null && analysis.sessionId === actor.sessionId) ||
      (actor.userId !== null && analysis.userId === actor.userId);
    if (!owns) {
      return null;
    }    const record = await this.assets.getById(sourceId);
    if (record === null || record.analysisId !== analysisId) {
      return null;
    }
    if (record.expiresAt.getTime() <= this.now().getTime()) {
      return null;
    }
    let stream: Readable;
    try {
      stream = await this.storage.get(record.storageKey);
    } catch {
      return null;
    }
    return { record, stream };
  }

  async deleteExpired(now: Date = this.now()): Promise<number> {
    const expired = await this.assets.listExpired(now);
    let removed = 0;
    for (const record of expired) {
      await this.storage.delete(record.storageKey).catch(() => undefined);
      await this.assets.deleteById(record.id).catch(() => undefined);
      removed += 1;
    }
    return removed;
  }

  async removeForAnalysis(analysisId: string): Promise<number> {
    const records = await this.assets.getByAnalysisId(analysisId);
    for (const record of records) {
      await this.storage.delete(record.storageKey).catch(() => undefined);
      await this.assets.deleteById(record.id).catch(() => undefined);
    }
    return records.length;
  }
}
