import "dotenv/config";
import { randomHex } from "../src/shared/utils/hash";
import { prisma } from "../src/database/client";
import { PrismaAnalysisEventStore } from "../src/database/repositories/analysis-event-repository";
import { InProcessAnalysisEventHub, PersistedAnalysisEventPublisher } from "../src/modules/analysis/application/analysis-event-hub";
import { createAnalysisSseStream } from "../src/modules/analysis/application/analysis-sse";
import { PrismaJobRepository } from "../src/database/repositories/job-repository";

async function main() {
  const store = new PrismaAnalysisEventStore();
  const hub = new InProcessAnalysisEventHub();
  const publisher = new PersistedAnalysisEventPublisher(store, hub);

  const session = await prisma.anonymousSession.create({
    data: {
      token_hash: `events-smoke-${randomHex(6)}`,
      expires_at: new Date(Date.now() + 86400000),
    },
  });
  const analysis = await prisma.analysis.create({
    data: {
      id: randomHex(20),
      session_id: session.id,
      source_type: "TEXT",
      document_type: "CONTRACT",
      output_language: "RU",
      explanation_mode: "STANDARD",
      retention_mode: "HISTORY",
      source_preview_mode: "HISTORY",
      detected_languages: ["ru"],
      status: "QUEUED",
    },
  });

  const stageNames = ["validating", "preparing_files", "extracting_content", "detecting_document_type", "analyzing", "checking_result", "normalizing", "saving", "completed"] as const;
  const ids: number[] = [];
  await publisher.publish({ analysisId: analysis.id, type: "analysis_created", stage: "queued", progress: 0, payload: { jobId: "job-1" } });
  for (const [i, stage] of stageNames.entries()) {
    const event = await publisher.publish({ analysisId: analysis.id, type: stage === "completed" ? "completed" : "stage_updated", stage, progress: (i + 1) * 10, payload: null });
    ids.push(event.id);
  }
  const monotonic = ids.every((id, i) => i === 0 || id > ids[i - 1]!);
  console.log("published:", ids.length + 1, "events, monotonic ids:", monotonic);

  const replayed = await store.listAfter(analysis.id, ids[0]!, 200);
  console.log("replay after first event:", replayed.length, "first id:", replayed[0]?.id);

  const controller = new AbortController();
  const stream = createAnalysisSseStream({ analysisId: analysis.id, lastEventId: ids[0]!, store, hub, signal: controller.signal });
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
    if (Buffer.from(chunk).toString("utf8").includes('event: completed')) break;
  }
  const text = chunks.map((c) => Buffer.from(c).toString("utf8")).join("");
  console.log("sse chunks:", chunks.length, "has stage_updated:", text.includes("stage_updated"), "has messageKey:", text.includes('"messageKey":"events.analysis.stage.analyzing"'), "has id:", text.includes(`id: ${ids[ids.length - 1]}`));

  const jobs = new PrismaJobRepository();
  const enqueued = await jobs.enqueue("analysis", { analysisId: analysis.id });
  const claimed = await jobs.claimNext("analysis");
  console.log("claim:", claimed?.id === enqueued.id, "attempt:", claimed?.attemptCount);
  const claimedAgain = await jobs.claimNext("analysis");
  console.log("second claim null:", claimedAgain === null);
  await jobs.complete(enqueued.id);

  const stuck = await prisma.jobQueueItem.create({
    data: { queue: "analysis", payload: { analysisId: analysis.id }, status: "RUNNING", updated_at: new Date(Date.now() - 20 * 60 * 1000) },
  });
  const reclaimed = await jobs.reclaimStale("analysis", new Date(Date.now() - 10 * 60 * 1000));
  const stuckAfter = await prisma.jobQueueItem.findUnique({ where: { id: stuck.id } });
  console.log("stale reclaimed:", reclaimed, "status after:", stuckAfter?.status);
  const stuck2 = await prisma.jobQueueItem.create({
    data: { queue: "analysis", payload: { analysisId: analysis.id }, status: "RUNNING", attempt_count: 3, updated_at: new Date(Date.now() - 20 * 60 * 1000) },
  });
  await jobs.reclaimStale("analysis", new Date(Date.now() - 10 * 60 * 1000));
  const stuck2After = await prisma.jobQueueItem.findUnique({ where: { id: stuck2.id } });
  console.log("exhausted status after:", stuck2After?.status, "error:", stuck2After?.last_error);

  const oldEvents = await prisma.analysisEvent.createMany({
    data: {
      analysis_id: analysis.id,
      type: "stage_updated",
      stage: "SAVING",
      progress: 95,
      message_key: "events.analysis.stage.saving",
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    },
  });
  const removed = await store.deleteOlderThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  console.log("old events created:", oldEvents.count, "removed by TTL:", removed);

  await prisma.analysisEvent.deleteMany({ where: { analysis_id: analysis.id } });
  await prisma.jobQueueItem.deleteMany({ where: { payload: { path: ["analysisId"], equals: analysis.id } } });
  await prisma.jobQueueItem.deleteMany({ where: { id: { in: [stuck.id, stuck2.id] } } });
  await prisma.analysis.delete({ where: { id: analysis.id } });
  await prisma.anonymousSession.delete({ where: { id: session.id } });
  console.log("ANALYSIS EVENTS SMOKE OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
