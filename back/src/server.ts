import "dotenv/config";
import { getConfig } from "./config";
import { prisma } from "./database";
import { createAppContext } from "./http/context";
import { FahmoHttpServer } from "./http/server";

async function main(): Promise<void> {
  const config = getConfig();
  const ctx = createAppContext({ config });
  const runtimeController = new AbortController();

  const server = new FahmoHttpServer({ config, ctx });
  await server.listen();
  console.log(`[http] Fahmo AI listening on http://${config.HTTP_HOST}:${config.HTTP_PORT}`);
  void ctx.analysisWorker.runForever(runtimeController.signal).catch((error) => {
    if (!runtimeController.signal.aborted) console.error("[worker] analysis loop failed", error);
  });
  void runExportLoop(ctx, runtimeController.signal);

  const shutdown = (): void => {
    console.log("[http] shutdown in progress…");
    runtimeController.abort();
    void (async () => {
      await server.close().catch(() => undefined);
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runExportLoop(
  ctx: ReturnType<typeof createAppContext>,
  signal: AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    try {
      await ctx.exportService.runNext();
    } catch (error) {
      if (!signal.aborted) console.error("[worker] export loop failed", error);
    }
    await sleep(1500, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); cleanup(); resolve(); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

void main().catch((error) => {
  console.error("[http] failed to start:", error);
  process.exit(1);
});
