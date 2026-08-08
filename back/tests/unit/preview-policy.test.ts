import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  HISTORY_TTL_DAYS,
  TEMPORARY_TTL_HOURS,
  previewPolicyFor,
} from "../../src/modules/preview/domain/policy";

test("PreviewPolicy: history → TTL 30 дней", () => {
  const policy = previewPolicyFor("history");
  assert.deepEqual(policy, { mode: "history", ttl: { days: HISTORY_TTL_DAYS } });
});

test("PreviewPolicy: temporary → TTL 24 часа", () => {
  const policy = previewPolicyFor("temporary");
  assert.deepEqual(policy, { mode: "temporary", ttl: { hours: TEMPORARY_TTL_HOURS } });
});

test("PreviewPolicy: no_preview → без хранения", () => {
  const policy = previewPolicyFor("no_preview");
  assert.deepEqual(policy, { mode: "no_preview", ttl: null });
});
