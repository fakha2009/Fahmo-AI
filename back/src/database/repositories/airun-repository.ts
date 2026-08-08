import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import type {
  AirRunAttempt,
  AirRunLogger,
} from "../../ai/gateway/airun-logger";
import { airRunFinalStatus, airRunOperation } from "../mappers/enums";

export class PrismaAirRunRepository implements AirRunLogger {
  async record(attempt: AirRunAttempt): Promise<void> {
    if (attempt.analysisId === null || attempt.status === "started") {
      return;
    }
    await prisma.aIRun.create({
      data: {
        analysis_id: attempt.analysisId,
        provider: attempt.provider,
        model: attempt.model,
        operation: airRunOperation.toPrisma(attempt.operation),
        status: airRunFinalStatus.toPrisma(attempt.status),
        latency_ms: attempt.latencyMs,
        input_tokens: attempt.inputTokens,
        output_tokens: attempt.outputTokens,
        estimated_cost:
          attempt.estimatedCost === null ? null : new Prisma.Decimal(attempt.estimatedCost),
        provider_request_id: attempt.providerRequestId,
        error_code: attempt.errorCode,
      },
    });
  }
}
