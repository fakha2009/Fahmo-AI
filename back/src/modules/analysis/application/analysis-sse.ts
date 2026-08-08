import type { AnalysisEvent } from "./analysis-event-publisher";
import { isTerminalEventType } from "./analysis-event-publisher";
import type { AnalysisEventHub } from "./analysis-event-hub";
import type { AnalysisEventStore } from "./analysis-event-store";

export const SSE_HEARTBEAT_MS = 15_000;
export const SSE_REPLAY_LIMIT = 200;

export interface AnalysisSseStreamOptions {
  analysisId: string;
  /** Курсор Last-Event-ID; null — восстановить последние события. */
  lastEventId: number | null;
  store: AnalysisEventStore;
  hub: AnalysisEventHub;
  signal: AbortSignal;
  heartbeatMs?: number;
  replayLimit?: number;
}

export function encodeSseEvent(event: AnalysisEvent): Uint8Array {
  const data = JSON.stringify({
    analysisId: event.analysisId,
    type: event.type,
    stage: event.stage,
    progress: event.progress,
    messageKey: event.messageKey,
    payload: event.payload ?? null,
    createdAt: event.createdAt.toISOString(),
  });
  return Buffer.from(`id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`, "utf8");
}

export function encodeSseComment(text: string): Uint8Array {
  return Buffer.from(`: ${text}\n\n`, "utf8");
}

/**
 * SSE-поток событий анализа:
 * 1) replay из хранилища (события с id > Last-Event-ID), затем
 * 2) live-подписка через hub (в пределах процесса), heartbeat и
 * 3) авто-закрытие после терминального события (completed/failed/cancelled/clarification_required).
 */
export async function* createAnalysisSseStream(
  options: AnalysisSseStreamOptions
): AsyncGenerator<Uint8Array> {
  const { analysisId, store, hub, signal } = options;
  const heartbeatMs = options.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const replayLimit = options.replayLimit ?? SSE_REPLAY_LIMIT;

  const queue: Uint8Array[] = [];
  let notify: (() => void) | null = null;
  let closed = false;

  const push = (bytes: Uint8Array): void => {
    queue.push(bytes);
    const wake = notify;
    notify = null;
    wake?.();
  };
  const close = (): void => {
    closed = true;
    const wake = notify;
    notify = null;
    wake?.();
  };
  const onEvent = (event: AnalysisEvent): void => {
    push(encodeSseEvent(event));
    if (isTerminalEventType(event.type)) {
      close();
    }
  };

  const unsubscribe = hub.subscribe(analysisId, onEvent);
  const heartbeat = setInterval(() => push(encodeSseComment("ping")), heartbeatMs);

  try {
    const replayed = await (options.lastEventId === null
      ? store.listForAnalysis(analysisId, replayLimit)
      : store.listAfter(analysisId, options.lastEventId, replayLimit));
    for (const event of replayed) {
      push(encodeSseEvent(event));
      if (isTerminalEventType(event.type)) {
        close();
        break;
      }
    }

    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as Uint8Array;
        continue;
      }
      if (closed || signal.aborted) {
        return;
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    clearInterval(heartbeat);
    unsubscribe();
  }
}
