import { randomHex, sha256Hex } from "../../../shared/utils/hash";
import { randomBytes } from "node:crypto";
import { AppError } from "../../../shared/errors";
import type { AnalysisRepository } from "../../analysis/application/analysis-repository";
import type { ShareRepository } from "./share-repository";
import type { ShareRecord } from "../domain/share";
import { createShareSnapshot } from "../domain/share";

const SHARE_TOKEN_BYTES = 32;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

export function hashShareToken(token: string): string {
  return sha256Hex(token);
}

export function isShareTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(token) && token.length >= 16 && token.length <= 128;
}

export interface ShareServiceOptions {
  tokenTtlMs?: number;
}

export class ShareService {
  constructor(
    private readonly shares: ShareRepository,
    private readonly analyses: AnalysisRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(analysisId: string, expiresAt: Date | null): Promise<{ token: string; share: ShareRecord }> {
    const analysis = await this.analyses.get(analysisId);
    if (analysis === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
    }
    if (analysis.status !== "completed" || analysis.result === null) {
      throw new AppError({ code: "ANALYSIS_NOT_READY", message: "Анализ ещё не готов для публикации" });
    }
    const token = generateShareToken();
    const tokenHash = hashShareToken(token);
    const snapshot = createShareSnapshot(analysis.result);
    const share = await this.shares.create({
      id: randomHex(16),
      analysisId,
      tokenHash,
      snapshot,
      expiresAt,
      createdAt: this.now(),
    });
    return { token, share };
  }

  async getPublicShare(token: string): Promise<ShareRecord> {
    if (!isShareTokenFormat(token)) {
      throw new AppError({ code: "NOT_FOUND", message: "Публичная ссылка не найдена" });
    }
    const share = await this.shares.getByTokenHash(hashShareToken(token));
    if (share === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Публичная ссылка не найдена" });
    }
    if (share.revokedAt !== null) {
      throw new AppError({ code: "SHARE_REVOKED" });
    }
    if (share.expiresAt !== null && share.expiresAt.getTime() <= this.now().getTime()) {
      throw new AppError({ code: "SHARE_EXPIRED" });
    }
    await this.shares.incrementViewCount(share.id, this.now());
    return share;
  }

  async revoke(shareId: string): Promise<void> {
    const share = await this.shares.get(shareId);
    if (share === null || share.revokedAt !== null) {
      return;
    }
    await this.shares.revoke(shareId, this.now());
  }

  async listByAnalysis(analysisId: string): Promise<ShareRecord[]> {
    return this.shares.listByAnalysisId(analysisId);
  }

  async deleteByAnalysis(analysisId: string): Promise<void> {
    await this.shares.deleteByAnalysisId(analysisId);
  }
}
