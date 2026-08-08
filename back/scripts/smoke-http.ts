/**
 * HTTP-смоук полного цикла: сессия (cookie jar) → создание анализа (multipart)
 * → статус → SSE-события → share → отмена. Запуск: npm run smoke:http
 * (предварительно: npm run start; HTTP-процесс запускает worker вместе с API).
 */
import { randomUUID } from "node:crypto";

const BASE = process.env.HTTP_BASE ?? "http://127.0.0.1:8787";

const cookieJar = new Map<string, string>();

async function request(path: string, options: RequestInit = {}): Promise<{ status: number; json: unknown }> {
  const headers = new Headers(options.headers ?? {});
  headers.set("X-Request-ID", randomUUID());
  if (cookieJar.size > 0) {
    headers.set("Cookie", [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
  }
  const response = await fetch(`${BASE}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie !== null) {
    for (const part of setCookie.split(",")) {
      const match = /^\s*([^=]+)=([^;]+)/.exec(part);
      if (match !== null) {
        cookieJar.set(match[1] ?? "", match[2] ?? "");
      }
    }
  }
  const contentType = response.headers.get("content-type") ?? "";
  const json = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
  return { status: response.status, json };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

async function main(): Promise<void> {
  const { status: healthStatus, json: health } = await request("/api/health");
  assert(healthStatus === 200, `health → ${healthStatus}`);
  assert((health as any)?.status === "ok", "health body");

  const { status: readyStatus } = await request("/api/ready");
  assert(readyStatus === 200, `ready → ${readyStatus}`);

  const form = new FormData();
  form.set("clientAnalysisId", "smoke-http-test");
  form.set("settings", JSON.stringify({ resultLanguage: "ru", explanationLevel: "simple", documentType: "work-order", provider: "remote" }));
  form.set(
    "pages",
    JSON.stringify([{ id: "p1", order: 0, rotation: 0, kind: "text", sourcePage: 1 }])
  );
  form.append(
    "texts",
    new Blob(
      ["Объявление: собрание жильцов состоится 15 августа в 18:00 в актовом зале. Присутствие обязательно."],
      { type: "text/plain" }
    ),
    "Текст"
  );

  const { status: createdStatus, json: created } = await request("/api/v1/analyses", {
    method: "POST",
    body: form,
    headers: { "Idempotency-Key": `smoke-${randomUUID().slice(0, 12)}` },
  });
  assert(createdStatus === 201, `create → ${createdStatus}`);
  const analysisId = (created as any)?.id ?? (created as any)?.analysisId;
  assert(typeof analysisId === "string" && analysisId.length > 0, "analysis id");
  console.log("created analysis:", analysisId);

  const unauthorizedStatus = await request(`/api/v1/analyses/${analysisId}`).then((r) => r.status);
  assert(unauthorizedStatus === 200, "status with session cookie");

  let finalStatus = "";
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { status, json } = await request(`/api/v1/analyses/${analysisId}`);
    assert(status === 200, `status → ${status}`);
    const payload = json as any;
    finalStatus = payload.status ?? "";
    if (["completed", "failed", "cancelled", "needs_clarification"].includes(finalStatus)) {
      console.log("final status:", finalStatus, "| result:", payload.result !== undefined);
      if (finalStatus === "failed") {
        console.log("analysis failure:", JSON.stringify(payload.error ?? payload.messageKey ?? null));
      }
      break;
    }
    await sleep(1500);
  }
  assert(["completed", "needs_clarification"].includes(finalStatus), `successful analysis status (received ${finalStatus})`);

  const controller = new AbortController();
  const ssePromise = fetch(`${BASE}/api/v1/analyses/${analysisId}/events`, {
    headers: {
      Cookie: [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      "Last-Event-ID": "0",
    },
    signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const sseResponse = await ssePromise;
    assert(sseResponse.status === 200, `sse → ${sseResponse.status}`);
    const reader = sseResponse.body?.getReader();
    assert(reader !== undefined, "sse body");
    const decoder = new TextDecoder();
    let buffer = "";
    let events = 0;
    while (true) {
      const { done, value } = await reader!.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        if (block.startsWith(":")) {
          continue;
        }
        const idMatch = /^id: (.+)$/m.exec(block);
        if (idMatch !== null) {
          events += 1;
        }
      }
      if (events > 0) {
        break;
      }
    }
    assert(events > 0, "SSE events replayed");
    console.log("SSE replay ok, events:", events);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  if (finalStatus === "completed") {
    const { status: shareStatus, json: share } = await request(`/api/v1/analyses/${analysisId}/shares`, {
      method: "POST",
    });
    assert(shareStatus === 201, `share create → ${shareStatus}`);
    const token = (share as any)?.token;
    assert(typeof token === "string", "share token");
    const { status: publicStatus, json: publicShare } = await request(`/api/v1/public/shares/${token}`);
    assert(publicStatus === 200, `public share → ${publicStatus}`);
    assert((publicShare as any)?.result?.title !== undefined, "public share has result");
    console.log("share ok:", (share as any)?.url);
  } else {
    console.log("share skipped (analysis not completed, status:", finalStatus + ")");
  }

  const cancelForm = new FormData();
  cancelForm.set("settings", JSON.stringify({ resultLanguage: "ru" }));
  cancelForm.set("pages", JSON.stringify([{ id: "p2", order: 0, rotation: 0, kind: "text", sourcePage: 1 }]));
  cancelForm.append("texts", new Blob(["Текст для отмены."], { type: "text/plain" }), "cancel.txt");
  const { status: cancelCreatedStatus, json: cancelCreated } = await request("/api/v1/analyses", {
    method: "POST",
    body: cancelForm,
  });
  assert(cancelCreatedStatus === 201, `cancel create → ${cancelCreatedStatus}`);
  const cancelId = (cancelCreated as any)?.id;
  const { status: cancelStatus } = await request(`/api/v1/analyses/${cancelId}/cancel`, { method: "POST" });
  assert(cancelStatus === 204, `cancel → ${cancelStatus}`);
  const { json: afterCancel } = await request(`/api/v1/analyses/${cancelId}`);
  assert((afterCancel as any)?.status === "cancelled", "analysis cancelled");
  console.log("cancel ok");

  const { status: notFoundStatus } = await request("/api/v1/analyses/does-not-exist-000000000000000000");
  assert(notFoundStatus === 404, `404 → ${notFoundStatus}`);

  const { status: exportStatus, json: exportJob } = await request("/api/v1/exports", {
    method: "POST",
    body: JSON.stringify({ kind: "data" }),
    headers: { "Content-Type": "application/json" },
  });
  assert(exportStatus === 201, `export create → ${exportStatus}`);
  const exportId = (exportJob as any)?.id;
  assert(typeof exportId === "string", "export id");
  const exportDeadline = Date.now() + 30_000;
  let exportDone = false;
  while (Date.now() < exportDeadline) {
    const { status, json } = await request(`/api/v1/exports/${exportId}`);
    assert(status === 200, `export status → ${status}`);
    if ((json as any)?.status === "done") {
      exportDone = true;
      break;
    }
    if ((json as any)?.status === "failed") {
      throw new Error("export failed");
    }
    await sleep(1000);
  }
  assert(exportDone, "export done");
  const download = await fetch(`${BASE}/api/v1/exports/${exportId}/download`, {
    headers: { Cookie: [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
  });
  assert(download.status === 200, `export download → ${download.status}`);
  const bytes = await download.arrayBuffer();
  assert(bytes.byteLength > 0, "export payload non-empty");
  console.log("export ok, bytes:", bytes.byteLength);

  console.log("SMOKE HTTP: ALL CHECKS PASSED");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error("SMOKE HTTP FAILED:", error);
  process.exit(1);
});
