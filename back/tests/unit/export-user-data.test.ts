import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildUserDataBundle,
  serializeUserDataBundle,
  type UserDataBundleInput,
} from "../../src/modules/exports/domain/user-data";

function input(): UserDataBundleInput {
  return {
    exportedAt: "2026-08-06T12:00:00.000Z",
    preferences: {
      ownerType: "session",
      themeMode: "dark",
      textScale: "normal",
      notificationEnabled: true,
      retentionMode: "history",
    },
    analyses: [
      {
        id: "analysis1",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T01:00:00.000Z",
        status: "completed",
        documentType: "contract",
        outputLanguage: "ru",
        title: "Договор аренды",
        summary: "Сводка",
        warnings: [{ code: "W", message: "m", severity: "info" }],
        simpleExplanation: "Просто",
        confidence: "high",
      },
    ],
    tasks: [
      {
        id: "task1",
        analysisId: "analysis1",
        title: "Оплатить",
        simpleTitle: "Платите",
        description: null,
        simpleDescription: null,
        status: "pending",
        priority: "high",
        dueAt: "2026-09-05T00:00:00.000Z",
        timezone: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    reminders: [
      {
        id: "rem1",
        taskId: "task1",
        channel: "in_app",
        remindAt: "2026-09-04T00:00:00.000Z",
        status: "scheduled",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    edits: [
      {
        analysisId: "analysis1",
        version: 2,
        changeSource: "user",
        createdAt: "2026-08-02T00:00:00.000Z",
        changedFields: ["dueAt"],
      },
    ],
  };
}

test("UserData: сборка архива с app и schemaVersion", () => {
  const bundle = buildUserDataBundle(input());
  assert.equal(bundle.app, "fahmo-ai");
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.analyses.length, 1);
  assert.equal(bundle.tasks.length, 1);
  assert.equal(bundle.reminders.length, 1);
  assert.equal(bundle.edits.length, 1);
});

test("UserData: не содержит оригинальных документов (поля source отсутствуют)", () => {
  const bundle = buildUserDataBundle(input());
  const serialized = serializeUserDataBundle(bundle);
  assert.ok(!serialized.includes("sourceData"));
  assert.ok(!serialized.includes("aiOriginal"));
  assert.ok(!serialized.includes("original"));
});

test("UserData: null-предпочтения остаются null", () => {
  const data = input();
  data.preferences = null;
  const bundle = buildUserDataBundle(data);
  assert.equal(bundle.preferences, null);
});

test("UserData: сериализация — валидный JSON с переносами", () => {
  const bundle = buildUserDataBundle(input());
  const serialized = serializeUserDataBundle(bundle);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.analyses[0].id, "analysis1");
});
