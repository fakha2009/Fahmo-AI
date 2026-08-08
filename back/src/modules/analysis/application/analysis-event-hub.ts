import type { AnalysisEvent } from "./analysis-event-publisher";
import type { AnalysisEventStore } from "./analysis-event-store";

export interface AnalysisEventHub {
  subscribe(analysisId: string, listener: (event: AnalysisEvent) => void): () => void;
  publish(event: AnalysisEvent): void;
}

/**
 * In-process шина доставки событий живым SSE-подписчикам.
 * Монотонность и порядок гарантируются последовательной доставкой
 * в одном процессе; кросс-процессная доставка — через хранилище + replay.
 */
export class InProcessAnalysisEventHub implements AnalysisEventHub {
  private readonly listeners = new Map<string, Set<(event: AnalysisEvent) => void>>();

  subscribe(analysisId: string, listener: (event: AnalysisEvent) => void): () => void {
    let set = this.listeners.get(analysisId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(analysisId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(analysisId);
      }
    };
  }

  publish(event: AnalysisEvent): void {
    const set = this.listeners.get(event.analysisId);
    if (set === undefined) {
      return;
    }
    for (const listener of [...set]) {
      try {
        listener(event);
      } catch {
        // Слушатель (SSE-поток) закрылся — он сам отпишется.
      }
    }
  }
}

/** Композиция: persist + live-доставка. */
export class PersistedAnalysisEventPublisher {
  constructor(
    private readonly store: AnalysisEventStore,
    private readonly hub: AnalysisEventHub
  ) {}

  async publish(input: Parameters<AnalysisEventStore["create"]>[0]): Promise<AnalysisEvent> {
    const event = await this.store.create(input);
    this.hub.publish(event);
    return event;
  }
}
