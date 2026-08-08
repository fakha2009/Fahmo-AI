import type { ProviderConfig } from "./provider";
import type { AIProvider } from "./provider";

export interface ProviderStats {
  attempts: number;
  errors: number;
  avgLatencyMs: number | null;
  lastLatencyMs: number | null;
}

export class ProviderRegistry {
  private readonly providers: AIProvider[] = [];
  private readonly configs = new Map<string, ProviderConfig>();
  private readonly stats = new Map<string, ProviderStats>();

  register(provider: AIProvider, config: ProviderConfig): void {
    if (provider.name !== config.name) {
      throw new Error(`Provider name mismatch: "${provider.name}" vs "${config.name}"`);
    }
    if (this.configs.has(provider.name)) {
      throw new Error(`Provider already registered: "${provider.name}"`);
    }
    this.providers.push(provider);
    this.configs.set(provider.name, config);
    this.stats.set(provider.name, { attempts: 0, errors: 0, avgLatencyMs: null, lastLatencyMs: null });
  }

  list(): AIProvider[] {
    return [...this.providers];
  }

  getByName(name: string): AIProvider | null {
    return this.providers.find((provider) => provider.name === name) ?? null;
  }

  getConfig(name: string): ProviderConfig | null {
    return this.configs.get(name) ?? null;
  }

  statsOf(name: string): ProviderStats {
    const existing = this.stats.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const empty: ProviderStats = { attempts: 0, errors: 0, avgLatencyMs: null, lastLatencyMs: null };
    this.stats.set(name, empty);
    return empty;
  }

  recordResult(name: string, latencyMs: number, ok: boolean): void {
    const stats = this.statsOf(name);
    stats.attempts += 1;
    if (!ok) {
      stats.errors += 1;
    }
    stats.lastLatencyMs = latencyMs;
    stats.avgLatencyMs =
      stats.avgLatencyMs === null
        ? latencyMs
        : stats.avgLatencyMs + (latencyMs - stats.avgLatencyMs) / stats.attempts;
  }
}
