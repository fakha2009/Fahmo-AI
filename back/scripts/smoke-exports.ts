import "dotenv/config";
import { randomHex } from "../src/shared/utils/hash";
import { prisma } from "../src/database/client";
import { PrismaAnalysisRepository } from "../src/database/repositories/analysis-repository";
import { PrismaTaskRepository } from "../src/database/repositories/task-repository";
import { PrismaReminderRepository } from "../src/database/repositories/reminder-repository";
import { PrismaAnalysisVersionRepository } from "../src/database/repositories/analysis-version-repository";
import { PrismaPreferencesRepository } from "../src/database/repositories/preferences-repository";
import { PrismaExportJobRepository } from "../src/database/repositories/export-repository";
import { ExportService } from "../src/modules/exports/application/export-service";
import type { ExportDataPorts } from "../src/modules/exports/application/export-runners";
import { LocalStorageAdapter } from "../src/storage/adapters/local";
import path from "node:path";

const owner = { sessionId: null as string | null, userId: null as string | null };

async function main() {
  const session = await prisma.anonymousSession.create({
    data: {
      token_hash: `export-smoke-${randomHex(8)}`,
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });
  owner.sessionId = session.id;
  console.log("session:", session.id);

  const analysis = await prisma.analysis.create({
    data: {
      id: randomHex(16),
      session_id: session.id,
      source_type: "TEXT",
      document_type: "CONTRACT",
      output_language: "RU",
      explanation_mode: "STANDARD",
      retention_mode: "HISTORY",
      source_preview_mode: "HISTORY",
      detected_languages: ["ru"],
      status: "COMPLETED",
      structured_result: {
        version: "1.0",
        title: "Договор аренды №5",
        documentType: "contract",
        detectedLanguages: ["ru"],
        outputLanguage: "ru",
        summary: "Аренда квартиры на 11 месяцев, 5000 сомони в месяц.",
        simpleExplanation: "Вы платите 5000 сомони каждый месяц 11 месяцев.",
        tasks: [],
        dates: [],
        amounts: [],
        locations: [],
        contacts: [],
        requiredDocuments: [],
        links: [],
        warnings: [
          { code: "CONFLICTING_INFORMATION", messageKey: "errors.conflictingInformation", params: {}, severity: "warning", sourceRefs: [] },
        ],
        clarificationQuestions: [],
        overallConfidence: "high",
      },
    },
  });
  console.log("analysis:", analysis.id);

  const task = await prisma.task.create({
    data: {
      id: randomHex(16),
      analysis_id: analysis.id,
      session_id: session.id,
      title: "Оплатить аренду до 5 числа",
      simple_title: "Платите до 5 числа",
      priority: "HIGH",
      status: "PENDING",
      due_at: new Date("2026-09-05T00:00:00.000Z"),
    },
  });
  console.log("task:", task.id);

  await prisma.reminder.create({
    data: {
      id: randomHex(16),
      task_id: task.id,
      scheduled_at: new Date("2026-09-04T08:00:00.000Z"),
      timezone: "Asia/Dushanbe",
      channel: "IN_APP",
    },
  });

  await prisma.analysisVersion.create({
    data: {
      id: randomHex(16),
      analysis_id: analysis.id,
      version: 2,
      change_source: "USER",
      ai_original: { summary: "old" },
      user_edited: { summary: "Аренда квартиры на 12 месяцев." },
      changed_fields: ["summary"],
    },
  });
  console.log("version created");

  const storage = new LocalStorageAdapter(path.join(process.cwd(), "tmp", "export-smoke"));
  const ports: ExportDataPorts = {
    analysisRepository: new PrismaAnalysisRepository(),
    taskRepository: new PrismaTaskRepository(),
    reminderRepository: new PrismaReminderRepository(),
    versionRepository: new PrismaAnalysisVersionRepository(),
    preferencesRepository: new PrismaPreferencesRepository(),
  };
  const service = new ExportService(new PrismaExportJobRepository(), ports, storage);

  for (const kind of ["pdf", "ics", "data"] as const) {
    const job = await service.createJob(owner, {
      kind,
      analysisId: kind === "pdf" ? analysis.id : null,
      taskIds: kind === "ics" ? [task.id] : undefined,
    });
    console.log(`[${kind}] job:`, job.id, job.status);
    const done = await service.runNext();
    if (done === null || done.status !== "done") {
      throw new Error(`export ${kind} failed: ${done?.status}`);
    }
    const artifact = await service.artifactFor(owner, job.id);
    console.log(`[${kind}] done, storageKey=${done.storageKey}, job.status=${artifact.job.status}`);
  }

  const jobs = await service.listJobs(owner, 10);
  console.log("jobs listed:", jobs.length);
  if (jobs.length < 3) throw new Error("expected at least 3 jobs");

  const expired = await service.cleanup(new Date(Date.now() + 1000 * 60 * 60 * 24 * 2));
  console.log("cleanup removed:", expired);

  await prisma.analysis.delete({ where: { id: analysis.id } });
  await prisma.anonymousSession.delete({ where: { id: session.id } });
  console.log("EXPORT SMOKE TEST OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
