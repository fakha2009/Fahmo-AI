import type { AnalysisStage } from "../../../validation/common";

export type AnalysisEventType =
  | "analysis_created"
  | "stage_updated"
  | "clarification_required"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_EVENT_TYPES: ReadonlySet<AnalysisEventType> = new Set([
  "completed",
  "failed",
  "cancelled",
  "clarification_required",
]);

export function isTerminalEventType(type: AnalysisEventType): boolean {
  return TERMINAL_EVENT_TYPES.has(type);
}

/** Локализуемый ключ события по умолчанию (клиент переводит на UI-слое). */
export function defaultMessageKey(type: AnalysisEventType, stage: AnalysisStage): string {
  if (type === "stage_updated") {
    return `events.analysis.stage.${stage}`;
  }
  return `events.analysis.${type}`;
}

export interface AnalysisEventInput {
  analysisId: string;
  type: AnalysisEventType;
  stage: AnalysisStage;
  progress: number;
  payload: Record<string, unknown> | null;
  /** Локализуемый ключ; при отсутствии подставляется defaultMessageKey(type, stage). */
  messageKey?: string | null;
}

export interface AnalysisEvent extends Omit<AnalysisEventInput, "messageKey"> {
  id: number;
  messageKey: string;
  createdAt: Date;
}

export interface AnalysisEventPublisher {
  publish(event: AnalysisEventInput): Promise<AnalysisEvent>;
}

export class NoopAnalysisEventPublisher implements AnalysisEventPublisher {
  async publish(input: AnalysisEventInput): Promise<AnalysisEvent> {
    return {
      ...input,
      id: 0,
      messageKey: input.messageKey ?? defaultMessageKey(input.type, input.stage),
      createdAt: new Date(),
    };
  }
}

export class InMemoryAnalysisEventPublisher implements AnalysisEventPublisher {
  private counter = 0;
  readonly events: AnalysisEvent[] = [];

  async publish(input: AnalysisEventInput): Promise<AnalysisEvent> {
    this.counter += 1;
    const event: AnalysisEvent = {
      ...input,
      id: this.counter,
      messageKey: input.messageKey ?? defaultMessageKey(input.type, input.stage),
      createdAt: new Date(),
    };
    this.events.push(event);
    return event;
  }
}
