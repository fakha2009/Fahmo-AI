import "dotenv/config";
import { getConfig } from "./config";
import { prisma } from "./database";
import { createAppContext } from "./http/context";
import { runCleanup } from "./workers/cleanup";

/**
 * Фоновый воркер: очередь анализа + экспортные джобы + периодическая очистка.
 * Запуск: npm run worker (отдельный процесс).
 */
async function main(): Promise<void> {
  const config = getConfig();
  const ctx = createAppContext({ config });
  const controller = new AbortController();

  const shutdown = (): void => {
    controller.abort();
    void (async () => {
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[worker] analysis worker started");
  void ctx.analysisWorker.runForever(controller.signal);

  console.log("[worker] export worker started");
  void runExportLoop(ctx, controller.signal);

  const cleanupInterval = setInterval(() => {
    void runCleanupOnce(ctx).catch((error) => console.error("[worker] cleanup failed:", error));
  }, 60_000);
  controller.signal.addEventListener("abort", () => clearInterval(cleanupInterval));
  void runCleanupOnce(ctx).catch(() => undefined);

  await new Promise<void>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve());
  });
}

async function runExportLoop(
  ctx: ReturnType<typeof createAppContext>,
  signal: AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    try {
      await ctx.exportService.runNext();
    } catch (error) {
      console.error("[worker] export job failed:", error);
    }
    await sleep(1500, signal);
  }
}

async function runCleanupOnce(ctx: ReturnType<typeof createAppContext>): Promise<void> {
  const result = await runCleanup({
    staging: {
      async cleanupExpired(now = new Date()) {
        return removeExpired(ctx, "staging/", now);
      },
    },
    assets: {
      async deleteExpired(now = new Date()) {
        return removeExpired(ctx, "previews/", now);
      },
    },
    events: {
      async deleteOlderThan(now: Date) {
        return ctx.eventStore.deleteOlderThan(now);
      },
    },
    jobs: {
      async reclaimStale(queue: string, before: Date) {
        return ctx.jobs.reclaimStale(queue, before);
      },
    },
  });
  console.log(
    `[worker] cleanup: ${result.stagedRemoved} staged, ${result.expiredAssetsRemoved} assets, ${result.eventsRemoved} events, ${result.staleJobsReclaimed} stale jobs`
  );
}

async function removeExpired(
  ctx: ReturnType<typeof createAppContext>,
  prefix: string,
  now: Date
): Promise<number> {
  const objects = await ctx.storage.list(prefix);
  let removed = 0;
  for (const object of objects) {
    if (object.expiresAt !== null && object.expiresAt.getTime() <= now.getTime()) {
      await ctx.storage.delete(object.key).catch(() => undefined);
      removed += 1;
    }
  }
  return removed;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

void main().catch((error) => {
  console.error("[worker] failed to start:", error);
  process.exit(1);
});
