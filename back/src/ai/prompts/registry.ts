import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const PromptDocumentTypeSchema = z.enum([
  "announcement",
  "work_assignment",
  "handwritten_note",
  "general",
]);

export type PromptDocumentType = z.infer<typeof PromptDocumentTypeSchema>;

export const DEFAULT_PROMPT_VERSION = "1.0.0";

export interface PromptVersionMeta {
  version: string;
  releasedAt: string;
  description: string;
  changelog: string[];
}

export interface PromptTemplate {
  documentType: PromptDocumentType;
  version: string;
  system: string;
  rules: string;
  schemaJson: string;
  schema: unknown;
}

const VERSIONS: Record<PromptDocumentType, PromptVersionMeta[]> = {
  announcement: [
    {
      version: "1.0.0",
      releasedAt: "2026-08-05",
      description: "Анализ объявлений: события, сроки, места, контакты",
      changelog: ["Первоначальная версия"],
    },
  ],
  work_assignment: [
    {
      version: "1.0.0",
      releasedAt: "2026-08-05",
      description: "Анализ поручений: задачи, исполнители, дедлайны",
      changelog: ["Первоначальная версия"],
    },
  ],
  handwritten_note: [
    {
      version: "1.0.0",
      releasedAt: "2026-08-05",
      description: "Анализ рукописных записей: OCR, неразборчивость, boundingBox",
      changelog: ["Первоначальная версия"],
    },
  ],
  general: [
    {
      version: "1.0.0",
      releasedAt: "2026-08-05",
      description: "Универсальный анализ документа любого типа",
      changelog: ["Первоначальная версия"],
    },
  ],
};

const HERE =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

function versionDir(version: string): string {
  return `v${version.split(".")[0]}`;
}

function readAsset(documentType: PromptDocumentType, version: string, name: string): string {
  return readFileSync(path.join(HERE, documentType, versionDir(version), name), "utf8");
}

function normalizeType(documentType: string | null | undefined): PromptDocumentType {
  const result = PromptDocumentTypeSchema.safeParse(documentType);
  if (!result.success) {
    return "general";
  }
  return result.data;
}

export class PromptRegistry {
  resolve(
    documentType: string | null | undefined,
    version: string | null = null
  ): PromptTemplate {
    const type = normalizeType(documentType);
    const versions = VERSIONS[type];
    const chosen =
      version === null || version === "latest"
        ? versions[0]
        : versions.find((candidate) => candidate.version === version);
    if (chosen === undefined) {
      throw new Error(
        `Версия промпта "${version}" не найдена для типа "${type}". Доступно: ${versions
          .map((candidate) => candidate.version)
          .join(", ")}`
      );
    }
    const system = readAsset(type, chosen.version, "system.md");
    const rules = readAsset(type, chosen.version, "rules.md");
    const schemaJson = readAsset(type, chosen.version, "schema.json");
    let schema: unknown;
    try {
      schema = JSON.parse(schemaJson) as unknown;
    } catch (error) {
      throw new Error(`schema.json для "${type}" v${chosen.version} не является валидным JSON`, {
        cause: error,
      });
    }
    return {
      documentType: type,
      version: chosen.version,
      system,
      rules,
      schemaJson,
      schema,
    };
  }

  list(): { documentType: PromptDocumentType; versions: PromptVersionMeta[] }[] {
    return (Object.keys(VERSIONS) as PromptDocumentType[]).map((documentType) => ({
      documentType,
      versions: VERSIONS[documentType],
    }));
  }
}

export const promptRegistry = new PromptRegistry();
