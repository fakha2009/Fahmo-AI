import { AppError } from "../../../shared/errors";
import { randomHex } from "../../../shared/utils/hash";
import { assertSafeStorageKey, type StoragePort } from "../../../storage/contracts/storage-port";
import type { Readable } from "node:stream";
import type { ExportKind } from "../../../validation/common";
import { PdfExportRenderer } from "../domain/pdf-document";
import { FontResolver } from "../domain/font-resolver";
import {
  DataExportRunner,
  IcsExportRunner,
  PdfExportRunner,
  artifactToReadable,
  type ExportArtifact,
  type ExportDataPorts,
} from "./export-runners";
import type { ExportJobRecord, ExportJobRepository } from "./export-repository";

export interface ExportOwner {
  sessionId: string | null;
  userId: string | null;
}

export interface ExportCreateInput {
  kind: ExportKind;
  analysisId?: string | null;
  taskIds?: string[];
}

const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const EXT_BY_KIND: Record<ExportKind, string> = { pdf: "pdf", ics: "ics", data: "json" };
const CONTENT_TYPE_BY_KIND: Record<ExportKind, string> = {
  pdf: "application/pdf",
  ics: "text/calendar; charset=utf-8",
  data: "application/json; charset=utf-8",
};

export class ExportService {
  private readonly pdfRunner: PdfExportRunner;
  private readonly icsRunner: IcsExportRunner;
  private readonly dataRunner: DataExportRunner;

  constructor(
    private readonly repository: ExportJobRepository,
    private readonly dataPorts: ExportDataPorts,
    private readonly storage: StoragePort,
    renderer: PdfExportRenderer = new PdfExportRenderer(),
    fontResolver: FontResolver = new FontResolver(),
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = () => randomHex(16)
  ) {
    this.pdfRunner = new PdfExportRunner(dataPorts, renderer, () => fontResolver.resolve());
    this.icsRunner = new IcsExportRunner(dataPorts);
    this.dataRunner = new DataExportRunner(dataPorts);
  }

  /** Создание асинхронного задания экспорта (QUEUED). */
  async createJob(owner: ExportOwner, input: ExportCreateInput): Promise<ExportJobRecord> {
    this.assertOwner(owner);
    this.validateInput(input);
    await this.assertOwnership(owner, input);

    const job = await this.repository.create({
      id: this.idFactory(),
      kind: input.kind,
      analysisId: input.kind === "pdf" ? (input.analysisId ?? null) : null,
      sessionId: owner.sessionId,
      userId: owner.userId,
      payload: input.kind === "ics" ? { taskIds: input.taskIds ?? [] } : null,
      expiresAt: new Date(this.now().getTime() + JOB_TTL_MS),
    });
    return job;
  }

  async getJob(owner: ExportOwner, id: string): Promise<ExportJobRecord | null> {
    this.assertOwner(owner);
    const job = await this.repository.get(id);
    if (job === null) {
      return null;
    }
    if (!this.isOwner(job, owner) || this.isExpired(job)) {
      return null;
    }
    return job;
  }

  async listJobs(owner: ExportOwner, limit: number): Promise<ExportJobRecord[]> {
    this.assertOwner(owner);
    return this.repository.listForOwner(owner.sessionId, owner.userId, limit);
  }

  /**
   * Асинхронный обработчик: захватывает следующий QUEUED-джоб, генерирует
   * артефакт, сохраняет в storage и переводит в DONE (или FAILED).
   */
  async runNext(): Promise<ExportJobRecord | null> {
    const job = await this.repository.claimNext(this.now());
    if (job === null) {
      return null;
    }
    try {
      const artifact = await this.buildArtifact(job);
      const key = await this.storeArtifact(job, artifact);
      const completed = await this.repository.complete(job.id, key, this.now());
      return completed ?? job;
    } catch {
      await this.repository.fail(job.id, "EXPORT_GENERATION_FAILED");
      return this.repository.get(job.id) ?? job;
    }
  }

  /** Готовый артефакт: только для DONE и только владельцу. */
  async artifactFor(
    owner: ExportOwner,
    id: string
  ): Promise<{ job: ExportJobRecord; stream: Readable }> {
    this.assertOwner(owner);
    const job = await this.repository.get(id);
    if (job === null || !this.isOwner(job, owner)) {
      throw new AppError({ code: "NOT_FOUND", message: "Экспорт не найден" });
    }
    if (job.status === "failed") {
      throw new AppError({ code: "EXPORT_GENERATION_FAILED", message: "Экспорт не сформирован" });
    }
    if (job.status !== "done" || job.storageKey === null) {
      throw new AppError({ code: "EXPORT_NOT_READY", message: "Экспорт ещё формируется" });
    }
    if (this.isExpired(job)) {
      throw new AppError({ code: "EXPORT_NOT_READY", message: "Срок действия экспорта истёк" });
    }
    return { job, stream: await this.storage.get(job.storageKey) };
  }

  async cleanup(now: Date = new Date()): Promise<number> {
    const expired = await this.repository.listExpired(now);
    for (const job of expired) {
      if (job.storageKey !== null) {
        try {
          await this.storage.delete(job.storageKey);
        } catch {
          // файл уже удалён
        }
      }
    }
    return this.repository.deleteExpired(now);
  }

  private async buildArtifact(job: ExportJobRecord): Promise<ExportArtifact> {
    switch (job.kind) {
      case "pdf": {
        if (job.analysisId === null) {
          throw new Error("pdf export requires analysisId");
        }
        const analysis = await this.dataPorts.analysisRepository.get(job.analysisId);
        if (analysis === null) {
          throw new Error(`analysis not found: ${job.analysisId}`);
        }
        return this.pdfRunner.run(job, analysis);
      }
      case "ics": {
        const payload = (job.payload ?? null) as { taskIds?: string[] } | null;
        return this.icsRunner.run(job, payload?.taskIds ?? []);
      }
      case "data":
        return this.dataRunner.run(job);
    }
  }

  private async storeArtifact(job: ExportJobRecord, artifact: ExportArtifact): Promise<string> {
    const ownerKey = job.sessionId ?? job.userId ?? "system";
    const key = `exports/${ownerKey}/${job.id}.${EXT_BY_KIND[job.kind]}`;
    assertSafeStorageKey(key);
    await this.storage.put({
      key,
      contentType: artifact.contentType ?? CONTENT_TYPE_BY_KIND[job.kind],
      body: artifactToReadable(artifact),
      expiresAt: job.expiresAt,
    });
    return key;
  }

  private validateInput(input: ExportCreateInput): void {
    switch (input.kind) {
      case "pdf": {
        if (input.analysisId === null || input.analysisId === undefined) {
          throw new AppError({ code: "VALIDATION_ERROR", message: "PDF-экспорт требует analysisId" });
        }
        break;
      }
      case "ics": {
        if (input.taskIds === undefined || input.taskIds.length === 0) {
          throw new AppError({ code: "VALIDATION_ERROR", message: "ICS-экспорт требует taskIds" });
        }
        if (input.taskIds.length > 100) {
          throw new AppError({ code: "VALIDATION_ERROR", message: "Не более 100 задач на экспорт" });
        }
        break;
      }
      case "data":
        break;
    }
  }

  private async assertOwnership(owner: ExportOwner, input: ExportCreateInput): Promise<void> {
    switch (input.kind) {
      case "pdf": {
        const analysis = await this.dataPorts.analysisRepository.get(input.analysisId!);
        if (analysis === null || !this.belongsTo(analysis.sessionId, analysis.userId, owner)) {
          throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
        }
        break;
      }
      case "ics": {
        for (const taskId of input.taskIds ?? []) {
          const task = await this.dataPorts.taskRepository.get(taskId);
          if (task === null || !this.belongsTo(task.sessionId, task.userId, owner)) {
            throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
          }
        }
        break;
      }
      case "data":
        break;
    }
  }

  private belongsTo(
    recordSessionId: string | null,
    recordUserId: string | null,
    owner: ExportOwner
  ): boolean {
    if (recordSessionId !== null) {
      return recordSessionId === owner.sessionId;
    }
    if (recordUserId !== null) {
      return recordUserId === owner.userId;
    }
    return false;
  }

  private assertOwner(owner: ExportOwner): void {
    const hasSession = owner.sessionId !== null;
    const hasUser = owner.userId !== null;
    if (hasSession === hasUser) {
      throw new AppError({ code: "UNAUTHORIZED", message: "Владелец: session XOR user" });
    }
  }

  private isOwner(job: ExportJobRecord, owner: ExportOwner): boolean {
    if (job.sessionId !== null) {
      return job.sessionId === owner.sessionId;
    }
    if (job.userId !== null) {
      return job.userId === owner.userId;
    }
    return false;
  }

  private isExpired(job: ExportJobRecord): boolean {
    return this.now().getTime() > job.expiresAt.getTime();
  }
}
