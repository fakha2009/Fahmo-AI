import type { AiOperation } from "./provider";

export type AirRunStatus = "started" | "success" | "failed";

export interface AirRunAttempt {
  analysisId: string | null;
  attempt: number;
  provider: string;
  model: string;
  operation: AiOperation;
  status: AirRunStatus;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  providerRequestId: string | null;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface AirRunLogger {
  record(attempt: AirRunAttempt): Promise<void>;
}

export class NoopAirRunLogger implements AirRunLogger {
  async record(_attempt: AirRunAttempt): Promise<void> {}
}
