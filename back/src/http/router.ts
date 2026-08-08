import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "./context";
import { AppError } from "../shared/errors/index";
import { sendErrorResponse } from "./responses";
import { createRequestContext, type RequestContext } from "./request-context";

export interface RouteParams {
  [name: string]: string;
}

export interface RouteHandlerInput {
  req: IncomingMessage;
  res: ServerResponse;
  ctx: AppContext;
  rc: RequestContext;
  params: RouteParams;
}

export type RouteHandler = (input: RouteHandlerInput) => Promise<void>;

interface RouteEntry {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: RouteEntry[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: path.split("/").filter(Boolean),
      handler,
    });
  }

  get(path: string, handler: RouteHandler): void {
    this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.add("POST", path, handler);
  }

  patch(path: string, handler: RouteHandler): void {
    this.add("PATCH", path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.add("DELETE", path, handler);
  }

  async dispatch(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
    const rc = createRequestContext(req);
    res.setHeader("X-Request-ID", rc.requestId);

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const segments = pathname.split("/").filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== req.method) {
        continue;
      }
      const params = matchSegments(route.segments, segments);
      if (params === null) {
        continue;
      }
      try {
        await route.handler({ req, res, ctx, rc, params });
      } catch (error) {
        await sendErrorResponse({ res, rc, error });
      }
      return;
    }

    await sendErrorResponse({
      res,
      rc,
      error: new AppError({ code: "NOT_FOUND", message: "Маршрут не найден", retryable: false }),
    });
  }
}

function matchSegments(pattern: string[], actual: string[]): RouteParams | null {
  if (pattern.length !== actual.length) {
    return null;
  }
  const params: RouteParams = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const part = pattern[index];
    if (part === undefined) {
      return null;
    }
    if (part.startsWith(":")) {
      params[part.slice(1)] = decodeURIComponent(actual[index] ?? "");
    } else if (part !== actual[index]) {
      return null;
    }
  }
  return params;
}
