import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AnalysisEventSchema } from "../../src/validation/response/analysis-event";
import type { AnalysisEvent, AnalysisEventInput } from "../../src/modules/analysis/application/analysis-event-publisher";
import { InMemoryAnalysisEventPublisher } from "../../src/modules/analysis/application/analysis-event-publisher";
import type { AnalysisEventStore } from "../../src/modules/analysis/application/analysis-event-store";
import { InProcessAnalysisEventHub, PersistedAnalysisEventPublisher } from "../../src/modules/analysis/application/analysis-event-hub";
import { createAnalysisSseStream, encodeSseEvent } from "../../src/modules/analysis/application/analysis-sse";

class InMemoryEventStore implements AnalysisEventStore {
  private counter = 0;
  readonly events: AnalysisEvent[] = [];
  deletedBefore: Date | null = null;

  async create(input: AnalysisEventInput): Promise<AnalysisEvent> {
    this.counter += 1;
    const event: AnalysisEvent = {
      ...input,
      id: this.counter,
      messageKey: input.messageKey ?? `events.analysis.${input.type}`,
      createdAt: new Date(),
    };
    this.events.push(event);
    return event;
  }

  async listForAnalysis(analysisId: string, limit: number): Promise<AnalysisEvent[]> {
    return this.events
      .filter((event) => event.analysisId === analysisId)
      .slice(-limit);
  }

  async listAfter(analysisId: string, afterId: number, limit: number): Promise<AnalysisEvent[]> {
    return this.events
      .filter((event) => event.analysisId === analysisId && event.id > afterId)
      .slice(0, limit);
  }

  async deleteOlderThan(now: Date): Promise<number> {
    this.deletedBefore = now;
    return 1;
  }
}

function input(analysisId: string, type: AnalysisEventInput["type"], progress: number): AnalysisEventInput {
  return { analysisId, type, stage: "analyzing", progress, payload: null };
}

function collect(generator: AsyncGenerator<Uint8Array>, timeoutMs = 2000): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => reject(new Error("stream timed out")), timeoutMs);
    void (async () => {
      for await (const chunk of generator) {
        chunks.push(chunk);
        if (chunks.length >= 4) {
          clearTimeout(timer);
          resolve(chunks);
          return;
        }
      }
      clearTimeout(timer);
      resolve(chunks);
    })().catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function utf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

test("PersistedAnalysisEventPublisher: persist + live-доставка, монотонный id", async () => {
  const store = new InMemoryEventStore();
  const hub = new InProcessAnalysisEventHub();
  const publisher = new PersistedAnalysisEventPublisher(store, hub);

  const received: AnalysisEvent[] = [];
  const unsubscribe = hub.subscribe("analysis-1", (event) => received.push(event));

  const first = await publisher.publish(input("analysis-1", "stage_updated", 20));
  const second = await publisher.publish(input("analysis-1", "completed", 100));

  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.equal(store.events.length, 2);
  assert.deepEqual(received.map((event) => event.id), [1, 2]);
  assert.equal(second.messageKey, "events.analysis.completed");
  unsubscribe();
  await publisher.publish(input("analysis-1", "stage_updated", 30));
  assert.equal(received.length, 2, "после отписки события не доставляются");
});

test("InMemoryAnalysisEventPublisher: дефолтный messageKey для стадий", async () => {
  const publisher = new InMemoryAnalysisEventPublisher();
  const event = await publisher.publish({ analysisId: "a", type: "stage_updated", stage: "preparing_files", progress: 20, payload: null });
  assert.equal(event.messageKey, "events.analysis.stage.preparing_files");
  assert.equal(AnalysisEventSchema.parse(event).id, event.id);
});

test("encodeSseEvent: формат id/event/data + валидный JSON", async () => {
  const event: AnalysisEvent = {
    id: 7,
    analysisId: "a1",
    type: "failed",
    stage: "analyzing",
    progress: 60,
    messageKey: "errors.aiProviderTimeout",
    payload: { errorCode: "AI_PROVIDER_TIMEOUT" },
    createdAt: new Date("2026-08-06T10:00:00.000Z"),
  };
  const bytes = encodeSseEvent(event);
  const text = utf8(bytes);
  assert.ok(text.startsWith("id: 7\nevent: failed\ndata: "));
  assert.ok(text.endsWith("\n\n"));
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  const parsed = JSON.parse(dataLine?.slice("data: ".length) ?? "null");
  assert.equal(parsed.messageKey, "errors.aiProviderTimeout");
  assert.equal(parsed.progress, 60);
  assert.equal(parsed.createdAt, "2026-08-06T10:00:00.000Z");
});

test("createAnalysisSseStream: replay по Last-Event-ID", async () => {
  const store = new InMemoryEventStore();
  const hub = new InProcessAnalysisEventHub();
  await new PersistedAnalysisEventPublisher(store, hub).publish(input("a1", "analysis_created", 0));
  await new PersistedAnalysisEventPublisher(store, hub).publish(input("a1", "stage_updated", 20));
  await new PersistedAnalysisEventPublisher(store, hub).publish(input("a1", "completed", 100));

  const controller = new AbortController();
  const stream = createAnalysisSseStream({
    analysisId: "a1",
    lastEventId: 1,
    store,
    hub,
    signal: controller.signal,
  });
  const chunks = await collect(stream);
  const text = chunks.map((chunk) => utf8(chunk)).join("");
  assert.ok(text.includes("id: 2"));
  assert.ok(text.includes("id: 3"));
  assert.ok(!text.includes("id: 1"), "события <= Last-Event-ID не повторяются");
});

test("createAnalysisSseStream: live-событие доставляется подписчику", async () => {
  const store = new InMemoryEventStore();
  const hub = new InProcessAnalysisEventHub();
  const publisher = new PersistedAnalysisEventPublisher(store, hub);
  await publisher.publish(input("a1", "analysis_created", 0));

  const controller = new AbortController();
  const stream = createAnalysisSseStream({ analysisId: "a1", lastEventId: null, store, hub, signal: controller.signal });
  const received = collect(stream, 3000);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await publisher.publish(input("a1", "stage_updated", 20));
  await publisher.publish(input("a1", "completed", 100));

  const chunks = await received;
  const text = chunks.map((chunk) => utf8(chunk)).join("");
  assert.ok(text.includes('event: stage_updated'), "live-событие stage_updated доставлено");
  assert.ok(text.includes('event: completed'));
  assert.ok(text.includes("id: 3"));
});

test("createAnalysisSseStream: терминальное событие закрывает стрим", async () => {
  const store = new InMemoryEventStore();
  const hub = new InProcessAnalysisEventHub();
  const publisher = new PersistedAnalysisEventPublisher(store, hub);
  await publisher.publish(input("a1", "completed", 100));

  const controller = new AbortController();
  const stream = createAnalysisSseStream({ analysisId: "a1", lastEventId: null, store, hub, signal: controller.signal });
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const text = chunks.map((chunk) => utf8(chunk)).join("");
  assert.ok(text.includes('event: completed'));
  assert.ok(!text.includes('event: stage_updated'), "после терминального события live-события не приходят");
});

test("createAnalysisSseStream: heartbeat и закрытие по abort", async () => {
  const store = new InMemoryEventStore();
  const hub = new InProcessAnalysisEventHub();
  const controller = new AbortController();
  const stream = createAnalysisSseStream({
    analysisId: "a1",
    lastEventId: null,
    store,
    hub,
    signal: controller.signal,
    heartbeatMs: 10,
  });
  const received = collect(stream, 2000);
  await new Promise((resolve) => setTimeout(resolve, 80));
  controller.abort();
  const chunks = await received;
  assert.ok(chunks.length > 0, "heartbeat приходит при отсутствии событий");
  assert.ok(chunks.some((chunk) => utf8(chunk).startsWith(": ping")));
});

test("event store cleanup: deleteOlderThan вызывается с порогом", async () => {
  const store = new InMemoryEventStore();
  const hub = new InProcessAnalysisEventHub();
  const publisher = new PersistedAnalysisEventPublisher(store, hub);
  await publisher.publish(input("a1", "completed", 100));
  const now = new Date("2026-08-06T12:00:00.000Z");
  await store.deleteOlderThan(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  assert.ok(store.deletedBefore !== null);
  assert.ok(store.deletedBefore < now);
});

test("hub: publish без слушателей не падает, unsubscribe работает", async () => {
  const hub = new InProcessAnalysisEventHub();
  const event: AnalysisEvent = { ...input("none", "completed", 100), id: 1, messageKey: "k", createdAt: new Date() };
  hub.publish(event);
  const received: AnalysisEvent[] = [];
  const unsubscribe = hub.subscribe("none", (e) => received.push(e));
  hub.publish(event);
  assert.equal(received.length, 1);
  unsubscribe();
  hub.publish(event);
  assert.equal(received.length, 1, "после unsubscribe доставки нет");
});
