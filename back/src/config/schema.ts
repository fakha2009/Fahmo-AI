import { z } from "zod";

// Zod-схема переменных окружения (ТЗ §29). Валидируется при старте приложения.
// Все переменные из .env.example обязательны, кроме отмеченных optional.

const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const ProviderIdSchema = z.enum(["gemini", "deepseek"]);

// CSV-порядок провайдеров: "gemini,deepseek" → ["gemini", "deepseek"]
const ProviderOrderSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  )
  .pipe(z.array(ProviderIdSchema).min(1));

const IntPositiveSchema = z.coerce.number().int().positive();

const BoolSchema = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // База данных
    DATABASE_URL: z.url(),

    // Приложение
    APP_URL: z.url(),
    FRONTEND_ORIGIN: z.url().optional(),
    SESSION_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY: z.string().min(32),
    LOG_LEVEL: LogLevelSchema.default("info"),

    // HTTP-сервер
    HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
    HTTP_HOST: z.string().min(1).default("127.0.0.1"),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default("http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:3000,http://localhost:3000")
      .transform((value) =>
        value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      ),
    STORAGE_DIR: z.string().min(1).default("./data"),

    // AI-провайдеры (пустые значения = провайдер отключён)
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).optional(),
    DEEPSEEK_API_KEY: z.string().min(1).optional(),
    DEEPSEEK_MODEL: z.string().min(1).optional(),

    // Маршрутизация провайдеров
    AI_VISION_PROVIDER_ORDER: ProviderOrderSchema.default(["gemini"]),
    AI_TEXT_PROVIDER_ORDER: ProviderOrderSchema.default(["deepseek", "gemini"]),
    AI_CLARIFICATION_PROVIDER_ORDER: ProviderOrderSchema.default(["deepseek", "gemini"]),
    AI_FALLBACK_ENABLED: BoolSchema,

    // Лимиты
    MAX_UPLOAD_BYTES: IntPositiveSchema.default(10 * 1024 * 1024),
    MAX_PDF_PAGES: IntPositiveSchema.default(20),
    MAX_IMAGE_COUNT: IntPositiveSchema.default(20),
    MAX_TEXT_LENGTH: IntPositiveSchema.default(50000),

    // Сессии и сроки
    ANONYMOUS_SESSION_TTL_DAYS: IntPositiveSchema.default(30),

    // Web Push
    WEB_PUSH_PUBLIC_KEY: z.string().min(1).optional(),
    WEB_PUSH_PRIVATE_KEY: z.string().min(1).optional(),
    WEB_PUSH_SUBJECT: z.string().min(1).optional(),

    // Cron
    CRON_SECRET: z.string().min(1).optional(),
  })
  .strict();

export type EnvConfig = z.infer<typeof EnvSchema>;
