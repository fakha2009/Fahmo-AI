import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { EnvConfig } from "../config";
import type { AppContext } from "./context";
import { Router } from "./router";
import { applyCors, handlePreflight, isPreflight, isTrustedRequestOrigin } from "./cors";
import { healthRoute, readyRoute } from "./routes/health";
import {
  analysisEventsRoute,
  cancelAnalysisRoute,
  createAnalysisRoute,
  deleteAnalysisRoute,
  getAnalysisRoute,
  listAnalysesRoute,
} from "./routes/analyses";
import { createShareRoute, publicShareRoute, revokeShareRoute } from "./routes/shares";
import {
  createExportRoute,
  downloadExportRoute,
  getExportRoute,
  listExportsRoute,
} from "./routes/exports";
import { sessionRoute } from "./routes/session";
import {
  completeTaskRoute,
  createTaskRoute,
  deleteTaskRoute,
  listAnalysisTasksRoute,
  patchTaskRoute,
} from "./routes/tasks";
import { createReminderRoute, deleteReminderRoute, patchReminderRoute } from "./routes/reminders";
import { getPreferencesRoute, patchPreferencesRoute } from "./routes/preferences";
import { listProvidersRoute } from "./routes/providers";
import { sourcePreviewRoute } from "./routes/sources";
import { answerClarificationRoute } from "./routes/clarifications";

export interface HttpServerOptions {
  config: EnvConfig;
  ctx: AppContext;
}

export class FahmoHttpServer {
  private readonly router = new Router();
  private readonly server: Server;
  private readonly config: EnvConfig;
  private readonly ctx: AppContext;

  constructor(options: HttpServerOptions) {
    this.config = options.config;
    this.ctx = options.ctx;
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.requestTimeout = 120_000;
    this.server.headersTimeout = 30_000;
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get("/api/health", healthRoute);
    this.router.get("/api/ready", readyRoute);
    this.router.get("/api/v1/session", sessionRoute);
    this.router.get("/api/v1/analyses", listAnalysesRoute);
    this.router.post("/api/v1/analyses", createAnalysisRoute);
    this.router.get("/api/v1/analyses/:analysisId", getAnalysisRoute);
    this.router.delete("/api/v1/analyses/:analysisId", deleteAnalysisRoute);
    this.router.post("/api/v1/analyses/:analysisId/cancel", cancelAnalysisRoute);
    this.router.get("/api/v1/analyses/:analysisId/events", analysisEventsRoute);
    this.router.get("/api/v1/analyses/:analysisId/tasks", listAnalysisTasksRoute);
    this.router.post("/api/v1/analyses/:analysisId/shares", createShareRoute);
    this.router.delete("/api/v1/analyses/:analysisId/shares/:shareId", revokeShareRoute);
    this.router.post("/api/v1/analyses/:analysisId/clarifications/:questionId/answer", answerClarificationRoute);
    this.router.get("/api/v1/analyses/:analysisId/sources/:sourceId", sourcePreviewRoute);
    this.router.get("/api/v1/public/shares/:token", publicShareRoute);
    this.router.post("/api/v1/tasks", createTaskRoute);
    this.router.patch("/api/v1/tasks/:taskId", patchTaskRoute);
    this.router.post("/api/v1/tasks/:taskId/complete", completeTaskRoute);
    this.router.delete("/api/v1/tasks/:taskId", deleteTaskRoute);
    this.router.post("/api/v1/tasks/:taskId/reminders", createReminderRoute);
    this.router.patch("/api/v1/reminders/:reminderId", patchReminderRoute);
    this.router.delete("/api/v1/reminders/:reminderId", deleteReminderRoute);
    this.router.get("/api/v1/preferences", getPreferencesRoute);
    this.router.patch("/api/v1/preferences", patchPreferencesRoute);
    this.router.get("/api/v1/ai/providers", listProvidersRoute);
    this.router.post("/api/v1/exports", createExportRoute);
    this.router.get("/api/v1/exports", listExportsRoute);
    this.router.get("/api/v1/exports/:exportId", getExportRoute);
    this.router.get("/api/v1/exports/:exportId/download", downloadExportRoute);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = { allowedOrigins: this.config.CORS_ALLOWED_ORIGINS };
    applyCors(req, res, cors);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    if (!isTrustedRequestOrigin(req, cors)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "FORBIDDEN", message: "Недоверенный Origin" } }));
      return;
    }
    if (isPreflight(req)) {
      handlePreflight(res);
      return;
    }
    try {
      await this.router.dispatch(req, res, this.ctx);
    } catch (error) {
      console.error("[http] unhandled error:", error);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end();
      }
    }
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.HTTP_PORT, this.config.HTTP_HOST, () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}
