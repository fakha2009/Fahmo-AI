import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  runCleanup,
  ANALYSIS_EVENTS_TTL_MS,
  ANALYSIS_JOB_STALE_MS,
  type CleanupAssetsLike,
  type CleanupEventsLike,
  type CleanupJobsLike,
  type CleanupStagingLike,
} from "../../src/workers/cleanup";

test("runCleanup: удаляет истёкшие staging и previews", async () => {
  let stagedRemoved = 0;
  let expiredRemoved = 0;
  const staging: CleanupStagingLike = {
    async cleanupExpired() {
      stagedRemoved += 1;
      return 3;
    },
  };
  const assets: CleanupAssetsLike = {
    async deleteExpired() {
      expiredRemoved += 1;
      return 5;
    },
  };
  const result = await runCleanup({ staging, assets }, new Date("2026-06-01T00:00:00Z"));
  assert.deepEqual(result, { stagedRemoved: 3, expiredAssetsRemoved: 5, eventsRemoved: 0, staleJobsReclaimed: 0 });
  assert.equal(stagedRemoved, 1);
  assert.equal(expiredRemoved, 1);
});

test("runCleanup: передаёт now в оба сервиса", async () => {
  const seen: (Date | undefined)[] = [];
  const staging: CleanupStagingLike = {
    async cleanupExpired(now) {
      seen.push(now);
      return 0;
    },
  };
  const assets: CleanupAssetsLike = {
    async deleteExpired(now) {
      seen.push(now);
      return 0;
    },
  };
  const now = new Date("2026-06-01T00:00:00Z");
  await runCleanup({ staging, assets }, now);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((date) => date !== undefined && date.getTime() === now.getTime()));
});

test("runCleanup: чистит события анализа (TTL) и возвращает застрявшие job'ы", async () => {
  const eventsBefore: Date[] = [];
  const jobBefore: Date[] = [];
  const staging: CleanupStagingLike = { async cleanupExpired() { return 0; } };
  const assets: CleanupAssetsLike = { async deleteExpired() { return 0; } };
  const events: CleanupEventsLike = {
    async deleteOlderThan(now) {
      if (now !== undefined) eventsBefore.push(now);
      return 12;
    },
  };
  const jobs: CleanupJobsLike = {
    async reclaimStale(_queue, before) {
      jobBefore.push(before);
      return 2;
    },
  };
  const now = new Date("2026-08-06T12:00:00Z");
  const result = await runCleanup({ staging, assets, events, jobs }, now);
  assert.equal(result.eventsRemoved, 12);
  assert.equal(result.staleJobsReclaimed, 2);
  assert.equal(eventsBefore.length, 1);
  assert.equal(eventsBefore[0]?.getTime(), now.getTime() - ANALYSIS_EVENTS_TTL_MS);
  assert.equal(jobBefore.length, 1);
  assert.equal(jobBefore[0]?.getTime(), now.getTime() - ANALYSIS_JOB_STALE_MS);
});
