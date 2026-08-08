import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../..//src/shared/errors";
import { hashShareToken } from "../../src/modules/shares/application/share-service";
import { ShareService } from "../../src/modules/shares/application/share-service";
import type {
  ShareRepository,
  ShareCreateInput,
} from "../../src/modules/shares/application/share-repository";
import type { ShareRecord } from "../../src/modules/shares/domain/share";
import type { AnalysisRepository } from "../../src/modules/analysis/application/analysis-repository";

class InMemoryShareRepository implements ShareRepository {
  private rows = new Map<string, ShareRecord>();

  async create(input: ShareCreateInput): Promise<ShareRecord> {
    const record: ShareRecord = {
      id: input.id,
      analysisId: input.analysisId,
      tokenHash: input.tokenHash,
      snapshot: input.snapshot,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: input.createdAt,
      lastViewedAt: null,
      viewCount: 0,
    };
    this.rows.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<ShareRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async getByTokenHash(tokenHash: string): Promise<ShareRecord | null> {
    for (const row of this.rows.values()) {
      if (row.tokenHash === tokenHash) {
        return row;
      }
    }
    return null;
  }

  async incrementViewCount(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.viewCount += 1;
      row.lastViewedAt = at;
    }
  }

  async revoke(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.revokedAt = at;
    }
  }

  async listByAnalysisId(analysisId: string): Promise<ShareRecord[]> {
    return Array.from(this.rows.values()).filter((row) => row.analysisId === analysisId);
  }

  async deleteByAnalysisId(analysisId: string): Promise<void> {
    for (const row of Array.from(this.rows.values())) {
      if (row.analysisId === analysisId) {
        this.rows.delete(row.id);
      }
    }
  }
}

class InMemoryAnalysisRepository implements AnalysisRepository {
  constructor(private readonly record: { id: string; status: string; result: unknown | null }) {}

  async create(): Promise<any> {
    throw new Error("Not implemented");
  }
  async get(id: string): Promise<any> {
    if (id === this.record.id) {
      return {
        ...this.record,
        status: this.record.status as any,
        result: this.record.result as any,
      };
    }
    return null;
  }
  async updateStage(): Promise<any> {
    throw new Error("Not implemented");
  }
  async updateStatus(): Promise<any> {
    throw new Error("Not implemented");
  }
  async saveResult(): Promise<void> {
    throw new Error("Not implemented");
  }
  async updateFields(): Promise<any> {
    throw new Error("Not implemented");
  }
  async listByOwner(): Promise<any> {
    throw new Error("Not implemented");
  }
}

function expectCode(error: unknown, code: string): void {
  assert.ok(error instanceof AppError, "Expected AppError");
  assert.equal(error.code, code);
}

function build(now = new Date("2026-01-01T00:00:00Z")) {
  const shareRepo = new InMemoryShareRepository();
  const analysisRepo = new InMemoryAnalysisRepository({
    id: "analysis-1",
    status: "completed",
    result: {
      version: "1.0.0",
      title: "Test",
      documentType: "other",
      detectedLanguages: ["ru"],
      outputLanguage: "ru",
      summary: "Summary",
      simpleExplanation: "Explanation",
      tasks: [],
      dates: [],
      amounts: [],
      locations: [],
      contacts: [],
      requiredDocuments: [],
      links: [],
      warnings: [],
      clarificationQuestions: [],
      overallConfidence: "medium",
    },
  });
  const service = new ShareService(shareRepo, analysisRepo, () => now);
  return { shareRepo, analysisRepo, service, now };
}

test("ShareService: create stores only token hash and snapshot omits clarification", async () => {
  const { service, shareRepo } = build();
  const { token, share } = await service.create("analysis-1", null);
  assert.match(token, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(share.revokedAt, null);
  assert.equal(share.viewCount, 0);
  assert.equal((share.snapshot as any).overallConfidence, undefined);
  assert.equal((share.snapshot as any).clarificationQuestions, undefined);
  const stored = await shareRepo.getByTokenHash(hashShareToken(token));
  assert.notEqual(stored, null);
  const unknown = await shareRepo.getByTokenHash(token);
  assert.equal(unknown, null);
});

test("ShareService: getPublicShare increments view count and lastViewedAt", async () => {
  const { service, shareRepo, now } = build();
  const { token, share } = await service.create("analysis-1", null);
  const result = await service.getPublicShare(token);
  assert.equal(result.id, share.id);
  assert.equal(result.viewCount, 1);
  assert.equal(result.lastViewedAt?.getTime(), now.getTime());
  const stored = await shareRepo.get(result.id);
  assert.equal(stored?.viewCount, 1);
});

test("ShareService: revoked share returns SHARE_REVOKED", async () => {
  const { service } = build();
  const { token, share } = await service.create("analysis-1", null);
  await service.revoke(share.id);
  await assert.rejects(async () => service.getPublicShare(token), (error: unknown) => {
    expectCode(error, "SHARE_REVOKED");
    return true;
  });
});

test("ShareService: expired share returns SHARE_EXPIRED", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const { service } = build(now);
  const { token } = await service.create("analysis-1", new Date(now.getTime() - 1000));
  await assert.rejects(async () => service.getPublicShare(token), (error: unknown) => {
    expectCode(error, "SHARE_EXPIRED");
    return true;
  });
});

test("ShareService: create rejects analysis not ready", async () => {
  const shareRepo = new InMemoryShareRepository();
  const analysisRepo = new InMemoryAnalysisRepository({
    id: "analysis-1",
    status: "processing",
    result: null,
  });
  const service = new ShareService(shareRepo, analysisRepo, () => new Date());
  await assert.rejects(async () => service.create("analysis-1", null), (error: unknown) => {
    expectCode(error, "ANALYSIS_NOT_READY");
    return true;
  });
});
