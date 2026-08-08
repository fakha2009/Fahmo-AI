import type { OutputLanguage } from "../../validation/common";
import { promptRegistry, type PromptTemplate } from "./registry";

export interface PromptVariables {
  language: OutputLanguage;
  documentType: string;
}

export function compilePrompt(template: PromptTemplate, variables: PromptVariables): string {
  const system = template.system
    .replace(/\{\{\s*language\s*\}\}/g, variables.language)
    .replace(/\{\{\s*documentType\s*\}\}/g, variables.documentType);
  return [
    system,
    "--- Правила ---",
    template.rules,
    "--- Схема ответа ---",
    template.schemaJson,
    "Верни ТОЛЬКО один JSON-объект, строго соответствующий схеме. Без markdown-разметки, комментариев и пояснений.",
  ].join("\n\n");
}

export interface DocumentPromptOptions {
  documentType?: string | null;
  version?: string | null;
}

export function buildDocumentPrompt(
  language: OutputLanguage,
  options: DocumentPromptOptions = {}
): string {
  const template = promptRegistry.resolve(options.documentType ?? null, options.version ?? null);
  return compilePrompt(template, {
    language,
    documentType: template.documentType,
  });
}

export function buildTextPrompt(
  language: OutputLanguage,
  options: DocumentPromptOptions = {}
): string {
  const template = promptRegistry.resolve("general", options.version ?? null);
  return [
    compilePrompt(template, { language, documentType: "general" }),
    "Проанализируй ТЕКСТ ниже как документ. Для sourceRefs используй clientPageId из контекста страницы, inputIndex=0, pageNumber=1.",
  ].join("\n\n");
}
