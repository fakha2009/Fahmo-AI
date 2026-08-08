export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function backoffDelay(baseMs: number, attempt: number, maxMs: number): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  return Math.min(exponential, maxMs);
}

export function totalBytesOfPages(pages: { content: string | Uint8Array }[]): number {
  return pages.reduce((sum, page) => {
    if (typeof page.content === "string") {
      return sum + Buffer.byteLength(page.content, "utf8");
    }
    return sum + page.content.byteLength;
  }, 0);
}
