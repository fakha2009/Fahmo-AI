import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { analysisStage } from "../mappers/enums";
import type { AnalysisEvent, AnalysisEventInput } from "../../modules/analysis/application/analysis-event-publisher";
import { defaultMessageKey } from "../../modules/analysis/application/analysis-event-publisher";
import type { AnalysisEventStore } from "../../modules/analysis/application/analysis-event-store";

const JSON_NULL = Prisma.DbNull;

function toEvent(row: {
  id: number;
  analysis_id: string;
  type: string;
  stage: unknown;
  progress: number;
  message_key: string;
  payload: Prisma.JsonValue | null;
  created_at: Date;
}): AnalysisEvent {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    type: row.type as AnalysisEvent["type"],
    stage: analysisStage.fromPrisma(row.stage as Parameters<typeof analysisStage.fromPrisma>[0]),
    progress: row.progress,
    messageKey: row.message_key,
    payload: (row.payload ?? null) as Record<string, unknown> | null,
    createdAt: row.created_at,
  };
}

export class PrismaAnalysisEventStore implements AnalysisEventStore {
  async create(input: AnalysisEventInput): Promise<AnalysisEvent> {
    const row = await prisma.analysisEvent.create({
      data: {
        analysis_id: input.analysisId,
        type: input.type,
        stage: analysisStage.toPrisma(input.stage),
        progress: input.progress,
        message_key: input.messageKey ?? defaultMessageKey(input.type, input.stage),
        payload: (input.payload === null ? JSON_NULL : input.payload) as Prisma.InputJsonValue | undefined,
      },
    });
    return toEvent(row);
  }

  async listForAnalysis(analysisId: string, limit: number): Promise<AnalysisEvent[]> {
    const rows = await prisma.analysisEvent.findMany({
      where: { analysis_id: analysisId },
      orderBy: { id: "desc" },
      take: limit,
    });
    return rows.reverse().map(toEvent);
  }

  async listAfter(analysisId: string, afterId: number, limit: number): Promise<AnalysisEvent[]> {
    const rows = await prisma.analysisEvent.findMany({
      where: { analysis_id: analysisId, id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: limit,
    });
    return rows.map(toEvent);
  }

  async deleteOlderThan(now: Date): Promise<number> {
    const result = await prisma.analysisEvent.deleteMany({
      where: { created_at: { lt: now } },
    });
    return result.count;
  }
}
