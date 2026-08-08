import { strict as assert } from "node:assert";
import { Readable } from "node:stream";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { streamToBuffer } from "../../src/shared/utils/stream";
import { SourceAssetService } from "../../src/modules/preview/application/source-asset-service";
import type {
  SourceAssetCreateInput,
  SourceAssetRecord,
  SourceAssetRepository,
} from "../../src/modules/preview/application/source-asset-repository";
import type { AnalysisRepository } from "../../src/modules/analysis/application/analysis-repository";
import type { SourcePreviewAsset } from "../../src/modules/ingestion/domain/types";

class InMemorySourceAssetRepository implements SourceAssetRepository {
  private records = new Map<string, SourceAssetRecord>();

  async create(input: SourceAssetCreateInput): Promise<SourceAssetRecord> {
    const record: SourceAssetRecord = {
      ...input,
      createdAt: new Date(),
    };
    this.records.set(input.id, record);
    return record;
  }

  async getById(id: string): Promise<SourceAssetRecord | null> {
    return this.records.get(id) ?? null;
  }

  async getByAnalysisId(analysisId: string): Promise<SourceAssetRecord[]> {
    return [...this.records.values()].filter((record) => record.analysisId === analysisId);
  }

  async deleteById(id: string): Promise<void> {
    this.records.delete(id);
  }

  async listExpired(now: Date): Promise<SourceAssetRecord[]> {
    return [...this.records.values()].filter((record) => record.expiresAt <= now);
  }
}

class FakeAnalysisRepository implements AnalysisRepository {
  constructor(private readonly records: Map<string, { sessionId: string | null; userId: string | null }>) {}

  async get(id: string) {
    const record = this.records.get(id);
    return record === undefined
      ? null
      : ({
          id,
          status: "completed",
          stage: "completed",
          progress: 100,
          sourceType: "image",
          documentType: "other",
          outputLanguage: "ru",
          retentionMode: "temporary",
          sourcePreviewMode: "temporary",
          result: null,
          detectedLanguages: [],
          provider: null,
          model: null,
          errorCode: null,
          revision: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
          sessionId: record.sessionId,
          userId: record.userId,
        } as Awaited<ReturnType<AnalysisRepository["get"]>>);
  }

  async create(): Promise<never> {
    throw new Error("not implemented");
  }
  async updateFields(): Promise<never> {
    throw new Error("not implemented");
  }
  async updateStage(): Promise<never> {
    throw new Error("not implemented");
  }
  async updateStatus(): Promise<never> {
    throw new Error("not implemented");
  }
  async saveResult(): Promise<never> {
    throw new Error("not implemented");
  }
  async listByOwner(): Promise<never> {
    throw new Error("not implemented");
  }
}

class InMemoryStorage {
  private objects = new Map<string, { body: Buffer; contentType: string; expiresAt: Date | null }>();

  async put(input: { key: string; contentType: string; body: Readable; expiresAt?: Date | null }) {
    const body = await streamToBuffer(input.body);
    this.objects.set(input.key, {
      body,
      contentType: input.contentType,
      expiresAt: input.expiresAt ?? null,
    });
    return {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: body.length,
      sha256: "abc",
      expiresAt: input.expiresAt ?? null,
    };
  }

  async get(key: string): Promise<Readable> {
    const object = this.objects.get(key);
    if (object === undefined) {
      throw new Error(`not found: ${key}`);
    }
    return Readable.from(object.body);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string) {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, object]) => ({
        key,
        contentType: object.contentType,
        sizeBytes: object.body.length,
        sha256: "abc",
        expiresAt: object.expiresAt,
      }));
  }
}

function preview(key: string, extra: Partial<SourcePreviewAsset> = {}): SourcePreviewAsset {
  return {
    clientPageId: "page-1",
    inputIndex: 0,
    pageNumber: 1,
    storageKey: key,
    mimeType: "image/jpeg",
    width: 100,
    height: 50,
    sha256: "abc",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...extra,
  };
}

function build(now = new Date("2026-06-01T00:00:00Z")) {
  const assets = new InMemorySourceAssetRepository();
  const analyses = new FakeAnalysisRepository(
    new Map([["analysis-1", { sessionId: "session-1", userId: null }]])
  );
  const storage = new InMemoryStorage();
  const service = new SourceAssetService(assets, analyses, storage, () => now);
  return { assets, analyses, storage, service, now };
}

test("SourceAssetService: save сохраняет записи для анализа", async () => {
  const { service, assets } = build();
  const records = await service.save("analysis-1", [
    preview("previews/1.jpeg"),
    preview("previews/2.jpeg", { clientPageId: "page-2", pageNumber: 2 }),
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.analysisId, "analysis-1");
  assert.equal(records[0]?.clientPageId, "page-1");
  assert.equal((await assets.getByAnalysisId("analysis-1")).length, 2);
});

test("SourceAssetService: владелец получает stream", async () => {
  const { service, storage } = build();
  await storage.put({
    key: "previews/1.jpeg",
    contentType: "image/jpeg",
    body: Readable.from(Buffer.from("preview-bytes")),
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  });
  const [record] = await service.save("analysis-1", [preview("previews/1.jpeg")]);
  const result = await service.getForOwner("analysis-1", record?.id ?? "missing", {
    sessionId: "session-1",
    userId: null,
  });
  assert.notEqual(result, null);
  assert.deepEqual(await streamToBuffer(result?.stream ?? Readable.from([])), Buffer.from("preview-bytes"));
});

test("SourceAssetService: чужой владелец не получает источник", async () => {
  const { service } = build();
  const [record] = await service.save("analysis-1", [preview("previews/1.jpeg")]);
  const result = await service.getForOwner("analysis-1", record?.id ?? "missing", {
    sessionId: "session-other",
    userId: null,
  });
  assert.equal(result, null);
});

test("SourceAssetService: без владельца → UNAUTHORIZED", async () => {
  const { service } = build();
  await assert.rejects(
    () => service.getForOwner("analysis-1", "any", { sessionId: null, userId: null }),
    (error: unknown) => error instanceof AppError && error.code === "UNAUTHORIZED"
  );
});

test("SourceAssetService: несуществующий анализ/источник/истёкший → null", async () => {
  const { service, storage } = build();
  await storage.put({
    key: "previews/1.jpeg",
    contentType: "image/jpeg",
    body: Readable.from(Buffer.from("bytes")),
    expiresAt: null,
  });
  const [record] = await service.save("analysis-1", [preview("previews/1.jpeg")]);
  assert.equal(
    await service.getForOwner("missing", record?.id ?? "x", { sessionId: "session-1", userId: null }),
    null
  );
  assert.equal(
    await service.getForOwner("analysis-1", "missing", { sessionId: "session-1", userId: null }),
    null
  );
  const expired = await service.save("analysis-1", [
    preview("previews/2.jpeg", { expiresAt: new Date("2026-01-01T00:00:00Z") }),
  ]);
  assert.equal(
    await service.getForOwner("analysis-1", expired[0]?.id ?? "x", {
      sessionId: "session-1",
      userId: null,
    }),
    null
  );
});

test("SourceAssetService: deleteExpired удаляет объекты и записи", async () => {
  const { service, assets, storage } = build(new Date("2026-06-01T00:00:00Z"));
  for (const key of ["previews/1.jpeg", "previews/2.jpeg"]) {
    await storage.put({
      key,
      contentType: "image/jpeg",
      body: Readable.from(Buffer.from("bytes")),
      expiresAt: null,
    });
  }
  await service.save("analysis-1", [
    preview("previews/1.jpeg", { expiresAt: new Date("2026-01-01T00:00:00Z") }),
    preview("previews/2.jpeg", { expiresAt: new Date("2027-01-01T00:00:00Z") }),
  ]);
  const removed = await service.deleteExpired();
  assert.equal(removed, 1);
  assert.equal((await assets.listExpired(new Date("2026-06-01T00:00:00Z"))).length, 0);
  assert.equal((await storage.list("previews/")).length, 1);
  assert.equal((await storage.list("previews/"))[0]?.key, "previews/2.jpeg");
});

test("SourceAssetService: removeForAnalysis удаляет всё по анализу", async () => {
  const { service, assets, storage } = build();
  await storage.put({
    key: "previews/1.jpeg",
    contentType: "image/jpeg",
    body: Readable.from(Buffer.from("bytes")),
    expiresAt: null,
  });
  await service.save("analysis-1", [preview("previews/1.jpeg")]);
  const removed = await service.removeForAnalysis("analysis-1");
  assert.equal(removed, 1);
  assert.equal((await assets.getByAnalysisId("analysis-1")).length, 0);
  assert.equal((await storage.list("previews/")).length, 0);
});
