import { Prisma, JobStatus as PrismaJobStatus } from "@prisma/client";
import { prisma } from "../client";
import type {
  ClaimedJob,
  EnqueuedJob,
  EnqueueJobOptions,
  JobRepository,
} from "../../modules/analysis/application/job-repository";

const DEFAULT_MAX_ATTEMPTS = 3;

export class PrismaJobRepository implements JobRepository {
  async enqueue(
    queue: string,
    payload: unknown,
    options?: EnqueueJobOptions
  ): Promise<EnqueuedJob> {
    const dedupKey = options?.dedupKey ?? null;
    if (dedupKey !== null) {
      const existing = await prisma.jobQueueItem.findFirst({
        where: { queue, dedup_key: dedupKey },
      });
      if (existing !== null) {
        return { id: existing.id, queue: existing.queue, payload: existing.payload };
      }
    }
    try {
      const row = await prisma.jobQueueItem.create({
        data: {
          queue,
          payload: payload as Prisma.InputJsonValue,
          dedup_key: dedupKey,
        },
      });
      return { id: row.id, queue: row.queue, payload: row.payload };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await prisma.jobQueueItem.findFirst({
          where: { queue, dedup_key: dedupKey },
        });
        if (existing !== null) {
          return { id: existing.id, queue: existing.queue, payload: existing.payload };
        }
      }
      throw error;
    }
  }

  async complete(id: string): Promise<void> {
    await prisma.jobQueueItem.updateMany({
      where: { id, status: { in: [PrismaJobStatus.QUEUED, PrismaJobStatus.RUNNING] } },
      data: { status: PrismaJobStatus.DONE, completed_at: new Date() },
    });
  }

  async fail(id: string, errorCode: string, errorMessage: string | null): Promise<void> {
    await prisma.jobQueueItem.updateMany({
      where: { id, status: { in: [PrismaJobStatus.QUEUED, PrismaJobStatus.RUNNING] } },
      data: { status: PrismaJobStatus.FAILED, last_error: errorMessage ?? errorCode },
    });
  }

  async claimNext(queue: string, now: Date = new Date()): Promise<ClaimedJob | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = await prisma.$transaction(
        async (tx) => {
          const candidate = await tx.jobQueueItem.findFirst({
            where: { queue, status: PrismaJobStatus.QUEUED, available_at: { lte: now } },
            orderBy: { created_at: "asc" },
          });
          if (candidate === null) {
            return null;
          }
          const updated = await tx.jobQueueItem.updateMany({
            where: { id: candidate.id, status: PrismaJobStatus.QUEUED },
            data: { status: PrismaJobStatus.RUNNING, attempt_count: { increment: 1 } },
          });
          if (updated.count === 0) {
            return null;
          }
          return {
            id: candidate.id,
            queue: candidate.queue,
            payload: candidate.payload,
            attemptCount: candidate.attempt_count + 1,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
      if (claimed !== null) {
        return claimed;
      }
    }
    return null;
  }

  async reclaimStale(queue: string, before: Date, maxAttempts: number = DEFAULT_MAX_ATTEMPTS): Promise<number> {
    const stale = await prisma.jobQueueItem.findMany({
      where: { queue, status: PrismaJobStatus.RUNNING, updated_at: { lt: before } },
      select: { id: true, attempt_count: true },
    });
    if (stale.length === 0) {
      return 0;
    }
    const retryIds = stale.filter((row) => row.attempt_count < maxAttempts).map((row) => row.id);
    const exhaustedIds = stale.filter((row) => row.attempt_count >= maxAttempts).map((row) => row.id);
    const [retried, exhausted] = await Promise.all([
      retryIds.length === 0
        ? Promise.resolve(0)
        : prisma.jobQueueItem.updateMany({
            where: { id: { in: retryIds }, status: PrismaJobStatus.RUNNING },
            data: {
              status: PrismaJobStatus.QUEUED,
              available_at: new Date(),
              last_error: "reclaimed after worker crash",
            },
          }).then((result) => result.count),
      exhaustedIds.length === 0
        ? Promise.resolve(0)
        : prisma.jobQueueItem.updateMany({
            where: { id: { in: exhaustedIds }, status: PrismaJobStatus.RUNNING },
            data: {
              status: PrismaJobStatus.FAILED,
              last_error: "max attempts exceeded",
            },
          }).then((result) => result.count),
    ]);
    return retried + exhausted;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
