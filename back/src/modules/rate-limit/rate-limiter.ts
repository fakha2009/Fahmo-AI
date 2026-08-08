export interface RateLimitResult {
  allowed: boolean;
  /** Остаток токенов после разрешённого запроса. */
  remaining: number;
  /** Секунды до пополнения следующего токена. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Токенов на интервал (всплеск). */
  capacity: number;
  /** Токенов в секунду (устойчивый темп). */
  refillRatePerSecond: number;
}

/**
 * Token bucket rate limiter (in-memory). Ключ — actor (session/user/IP).
 * Через инъекцию часов тестируется без реального ожидания.
 */
export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly options: RateLimiterOptions,
    private readonly now: () => number = () => Date.now()
  ) {
    if (options.capacity < 1 || options.refillRatePerSecond <= 0) {
      throw new Error("RateLimiterOptions: capacity >= 1, refillRatePerSecond > 0");
    }
  }

  consume(key: string, cost = 1): RateLimitResult {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: this.options.capacity, updatedAt: nowMs };
      this.buckets.set(key, bucket);
    }
    const elapsedSeconds = Math.max(0, (nowMs - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(
      this.options.capacity,
      bucket.tokens + elapsedSeconds * this.options.refillRatePerSecond
    );
    bucket.updatedAt = nowMs;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterSeconds: 0,
      };
    }
    const retryAfterSeconds =
      (cost - bucket.tokens) / this.options.refillRatePerSecond;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterSeconds * 1000) / 1000,
    };
  }
}
