import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TokenBucketRateLimiter } from "../../src/modules/rate-limit/rate-limiter";

test("RateLimiter: всплеск до capacity разрешён, дальше — блок", () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRatePerSecond: 1 });
  assert.equal(limiter.consume("ip-1").allowed, true);
  assert.equal(limiter.consume("ip-1").allowed, true);
  assert.equal(limiter.consume("ip-1").allowed, true);
  const blocked = limiter.consume("ip-1");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("RateLimiter: ключи изолированы", () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 1, refillRatePerSecond: 1 });
  assert.equal(limiter.consume("ip-1").allowed, true);
  assert.equal(limiter.consume("ip-2").allowed, true);
});

test("RateLimiter: токены пополняются со временем", () => {
  let nowMs = 1_000_000;
  const limiter = new TokenBucketRateLimiter(
    { capacity: 2, refillRatePerSecond: 1 },
    () => nowMs
  );
  assert.equal(limiter.consume("k").allowed, true);
  assert.equal(limiter.consume("k").allowed, true);
  assert.equal(limiter.consume("k").allowed, false);

  nowMs += 2_000;
  const after = limiter.consume("k");
  assert.equal(after.allowed, true);
  assert.equal(after.remaining, 1);
});

test("RateLimiter: capacity не превышается при долгом простое", () => {
  let nowMs = 0;
  const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRatePerSecond: 10 }, () => nowMs);
  nowMs += 60_000;
  const result = limiter.consume("k");
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 4);
});

test("RateLimiter: невалидные параметры отклоняются", () => {
  assert.throws(() => new TokenBucketRateLimiter({ capacity: 0, refillRatePerSecond: 1 }));
  assert.throws(() => new TokenBucketRateLimiter({ capacity: 1, refillRatePerSecond: 0 }));
});
