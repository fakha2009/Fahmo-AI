import { strict as assert } from "node:assert";
import { test } from "node:test";
import { revisionConflict } from "../../src/modules/versioning/domain/concurrency";

test("revisionConflict возвращает AppError VERSION_CONFLICT с serverRevision", () => {
  const error = revisionConflict(7);
  assert.equal(error.name, "AppError");
  assert.equal(error.code, "VERSION_CONFLICT");
  assert.equal(error.params.serverRevision, 7);
  assert.equal(error.retryable, false);
});

test("revisionConflict не ретраябелен", () => {
  const error = revisionConflict(3);
  assert.equal(error.retryable, false);
});
