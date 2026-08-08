import { config as loadDotenv } from "dotenv";
import { EnvSchema, type EnvConfig } from "./schema";

let cached: EnvConfig | null = null;

export type Config = EnvConfig;
export type { EnvConfig } from "./schema";

export function parseEnv(env: NodeJS.ProcessEnv): EnvConfig {
  return EnvSchema.parse(env);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  if (env === process.env) {
    loadDotenv();
  }
  const known = Object.fromEntries(
    Object.keys(env).filter((key) => key in EnvSchema.shape).map((key) => [key, env[key]])
  );
  if (known.HTTP_PORT === undefined && known.PORT !== undefined) {
    known.HTTP_PORT = known.PORT;
  }
  const config = parseEnv(known);
  const allowedOrigins = new Set(config.CORS_ALLOWED_ORIGINS);
  if (config.FRONTEND_ORIGIN !== undefined) {
    allowedOrigins.add(new URL(config.FRONTEND_ORIGIN).origin);
  }
  return { ...config, CORS_ALLOWED_ORIGINS: [...allowedOrigins] };
}

export function getConfig(): EnvConfig {
  if (cached === null) {
    cached = loadConfig();
  }
  return cached;
}

export function resetConfig(): void {
  cached = null;
}
