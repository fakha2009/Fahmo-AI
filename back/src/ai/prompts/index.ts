import type { OutputLanguage } from "../../validation/common";

export * from "./registry";
export * from "./compiler";

const JSON_INSTRUCTION =
  'Отвечай строго на языке запроса. Верни ТОЛЬКО один JSON-объект без markdown-разметки и комментариев.';

export const SIMPLIFY_PROMPT_VERSION = "1.0.0";
export const CLARIFICATION_PROMPT_VERSION = "1.0.0";

export function simplifySystemPrompt(
  language: OutputLanguage,
  audience: "child" | "elder" | "general"
): string {
  return [
    "Ты эксперт по упрощению юридических и деловых документов.",
    "Получив результат анализа документа, перепиши summary и simpleExplanation",
    "простыми словами для аудитории:",
    audience === "child"
      ? "- child: объяснение для ребёнка, короткие предложения"
      : audience === "elder"
        ? "- elder: спокойный стиль, без канцелярита и аббревиатур"
        : "- general: обычный человек, минимум терминов",
    "Верни JSON: { summary, simpleExplanation }.",
    JSON_INSTRUCTION,
    `Язык ответа: ${language}`,
  ].join("\n");
}

export function clarificationSystemPrompt(language: OutputLanguage): string {
  return [
    "Ты помощник, уточняющий анализ документа по ответам пользователя.",
    "Получив вопрос, ответ пользователя и текущий результат анализа, обнови только те поля,",
    "которые изменились из-за ответа (summary, simpleExplanation, tasks, dates, amounts,",
    "warnings, overallConfidence и т.д.). Не выдумывай новые факты, не упомянутые в ответе.",
    "Если ответ не влияет на анализ, верни пустой объект {}.",
    JSON_INSTRUCTION,
    `Язык ответа: ${language}`,
  ].join("\n");
}
