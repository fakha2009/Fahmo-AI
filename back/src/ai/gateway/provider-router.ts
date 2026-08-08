import type { OutputLanguage } from "../../validation/common";
import type { AiInputType, AiOperation } from "./provider";
import type { AIProvider } from "./provider";
import type { ProviderRegistry } from "./provider-registry";

export interface RouteRequest {
  operation: AiOperation;
  inputType: AiInputType;
  language: OutputLanguage;
  pageCount: number;
  inputBytes: number;
  preferLowLatency?: boolean;
  preferLowCost?: boolean;
  preferredProvider?: string | null;
}

const NO_LATENCY_SCORE = 1_000_000;
const PREFERRED_SCORE = -1_000_000;

export class ProviderRouter {
  constructor(private readonly registry: ProviderRegistry) {}

  route(request: RouteRequest): AIProvider[] {
    return this.registry
      .list()
      .filter((provider) => this.matches(provider, request))
      .sort((a, b) => this.score(a, request) - this.score(b, request));
  }

  private matches(provider: AIProvider, request: RouteRequest): boolean {
    const capabilities = provider.getCapabilities();
    if (!capabilities.available) {
      return false;
    }
    if (!capabilities.supportedInputs.includes(request.inputType)) {
      return false;
    }
    if (!capabilities.supportedLanguages.includes(request.language)) {
      return false;
    }
    if (capabilities.maxInputPages < request.pageCount) {
      return false;
    }
    if (capabilities.maxInputBytes < request.inputBytes) {
      return false;
    }
    return true;
  }

  private score(provider: AIProvider, request: RouteRequest): number {
    if (request.preferredProvider !== null && request.preferredProvider !== undefined && provider.name === request.preferredProvider) {
      return PREFERRED_SCORE;
    }
    const stats = this.registry.statsOf(provider.name);
    const latencyScore = request.preferLowLatency
      ? (stats.avgLatencyMs ?? NO_LATENCY_SCORE)
      : 0;
    const config = this.registry.getConfig(provider.name);
    const costScore = request.preferLowCost
      ? ((config?.costPerMillionInput ?? 0) + (config?.costPerMillionOutput ?? 0)) / 1_000_000
      : 0;
    const priorityScore = config?.operationPriorities?.[request.operation]
      ?? config?.priority
      ?? Number.MAX_SAFE_INTEGER;
    return latencyScore + costScore + priorityScore;
  }
}
