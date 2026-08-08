import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  SyncService,
  decodeSyncCursor,
  encodeSyncCursor,
} from "../../src/modules/sync/application/sync-service";
import type {
  SyncChangeRepository,
  SyncItem,
  SyncOwner,
} from "../../src/modules/sync/application/sync-repository";

class InMemorySyncRepository implements SyncChangeRepository {
  calls: { owner: SyncOwner; since: Date; limit: number }[] = [];

  constructor(private readonly items: SyncItem[]) {}

  async listChanges(owner: SyncOwner, since: Date, limit: number): Promise<SyncItem[]> {
    this.calls.push({ owner, since, limit });
    return this.items
      .filter((item) => new Date(item.updatedAt).getTime() > since.getTime())
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit);
  }
}

function item(
  id: string,
  updatedAt: string,
  entity: "task" | "preferences" = "task"
): SyncItem {
  if (entity === "task") {
    return {
      entity,
      id,
      revision: 1,
      updatedAt,
      deleted: false,
      data: {
        id,
        analysisId: null,
        sessionId: "session",
        userId: null,
        title: id,
        description: null,
        simpleTitle: id,
        simpleDescription: null,
        assigneeText: null,
        priority: "medium",
        status: "pending",
        dueAt: null,
        timezone: null,
        sourceData: null,
        aiOriginal: null,
        clientMutationId: null,
        revision: 1,
        completedAt: null,
        createdAt: new Date(updatedAt),
        updatedAt: new Date(updatedAt),
        deletedAt: null,
      },
    };
  }
  return {
    entity,
    id,
    revision: 1,
    updatedAt,
    deleted: false,
    data: {
      id,
      sessionId: "session",
      userId: null,
      interfaceLanguage: "ru",
      outputLanguage: "ru",
      explanationMode: "standard",
      theme: "system",
      reducedMotion: false,
      textScale: "normal",
      timezone: "Asia/Dushanbe",
      preferredProvider: null,
      saveHistory: true,
      sourcePreviewMode: "history",
      retentionMode: "history",
      defaultReminderOffsetMinutes: null,
      pushEnabled: false,
      revision: 1,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
    },
  };
}

test("пустой список: items [], nextCursor null, hasMore false", async () => {
  const service = new SyncService(new InMemorySyncRepository([]));
  const page = await service.getChanges(
    { sessionId: "s", userId: null },
    { updatedAfter: new Date("2026-01-01T00:00:00Z"), limit: 20 }
  );
  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
  assert.equal(page.hasMore, false);
});

test("фильтр updatedAfter и сортировка по updatedAt asc", async () => {
  const repo = new InMemorySyncRepository([
    item("c", "2026-01-03T00:00:00Z"),
    item("a", "2026-01-01T00:00:00Z"),
    item("b", "2026-01-02T00:00:00Z"),
  ]);
  const service = new SyncService(repo);
  const page = await service.getChanges(
    { sessionId: "s", userId: null },
    { updatedAfter: new Date("2026-01-01T00:00:00Z"), limit: 20 }
  );
  assert.deepEqual(
    page.items.map((change) => change.id),
    ["b", "c"]
  );
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, encodeSyncCursor("2026-01-03T00:00:00Z"));
});

test("items == limit: hasMore true, cursor позволяет продолжить", async () => {
  const repo = new InMemorySyncRepository([
    item("1", "2026-01-01T00:00:00Z"),
    item("2", "2026-01-02T00:00:00Z"),
    item("3", "2026-01-03T00:00:00Z"),
  ]);
  const service = new SyncService(repo);
  const first = await service.getChanges(
    { sessionId: "s", userId: null },
    { updatedAfter: new Date("2025-12-31T00:00:00Z"), limit: 2 }
  );
  assert.deepEqual(
    first.items.map((change) => change.id),
    ["1", "2"]
  );
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, encodeSyncCursor("2026-01-02T00:00:00Z"));

  const since = decodeSyncCursor(first.nextCursor as string);
  assert.ok(since !== null);
  const second = await service.getChanges(
    { sessionId: "s", userId: null },
    { updatedAfter: since, limit: 2 }
  );
  assert.deepEqual(
    second.items.map((change) => change.id),
    ["3"]
  );
  assert.equal(second.hasMore, false);
});

test("смешанные сущности объединяются в одном потоке по updatedAt", async () => {
  const repo = new InMemorySyncRepository([
    item("task-1", "2026-01-01T00:00:00Z"),
    item("prefs-1", "2026-01-02T00:00:00Z", "preferences"),
  ]);
  const service = new SyncService(repo);
  const page = await service.getChanges(
    { sessionId: "s", userId: null },
    { updatedAfter: new Date("2025-12-31T00:00:00Z"), limit: 10 }
  );
  assert.deepEqual(
    page.items.map((change) => [change.entity, change.id]),
    [
      ["task", "task-1"],
      ["preferences", "prefs-1"],
    ]
  );
});

test("владелец прокидывается в репозиторий как есть", async () => {
  const repo = new InMemorySyncRepository([]);
  const service = new SyncService(repo);
  await service.getChanges(
    { sessionId: null, userId: "u1" },
    { updatedAfter: new Date("2026-01-01T00:00:00Z"), limit: 5 }
  );
  assert.equal(repo.calls.length, 1);
  const call = repo.calls[0];
  assert.ok(call !== undefined);
  assert.deepEqual(call.owner, { sessionId: null, userId: "u1" });
  assert.equal(call.limit, 5);
});

test("cursor: base64url round-trip и отказ от посторонних значений", () => {
  const encoded = encodeSyncCursor("2026-01-02T03:04:05.678Z");
  assert.ok(encoded !== "");
  const decoded = decodeSyncCursor(encoded);
  assert.ok(decoded !== null);
  assert.equal(decoded.toISOString(), "2026-01-02T03:04:05.678Z");
  assert.equal(decodeSyncCursor("not-a-cursor"), null);
  assert.equal(decodeSyncCursor(""), null);
});
