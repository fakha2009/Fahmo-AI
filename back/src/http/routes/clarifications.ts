import { z } from "zod";
import { AppError } from "../../shared/errors";
import { AnalysisTaskMaterializer } from "../../modules/tasks/application/analysis-task-materializer";
import type { RouteHandler } from "../router";
import { readJsonBody } from "../body";
import { sendJson } from "../responses";
import { requireSession } from "../session";
import { mapAnalysisResult } from "../mappers/result";

const AnswerSchema = z.object({ answer: z.string().trim().min(1).max(1000) }).strict();

export const answerClarificationRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const analysis = await ctx.analysisRepository.get(params.analysisId ?? "");
  if (analysis === null || analysis.sessionId !== session.session.id || analysis.result === null) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  const parsed = AnswerSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректный ответ", details: parsed.error.issues });
  }
  const index = clarificationIndex(params.questionId ?? "");
  const question = index === null ? undefined : analysis.result.clarificationQuestions[index];
  if (question === undefined) {
    throw new AppError({ code: "NOT_FOUND", message: "Уточнение не найдено" });
  }
  const result = await ctx.aiGateway.answerClarification({
    analysisId: analysis.id,
    language: analysis.outputLanguage,
    question,
    answer: parsed.data.answer,
    previousResult: analysis.result,
  }, analysis.result);
  await ctx.analysisRepository.saveResult(analysis.id, {
    result,
    detectedLanguages: result.detectedLanguages,
    provider: analysis.provider ?? "unknown",
    model: analysis.model ?? "unknown",
    overallConfidence: result.overallConfidence,
    revision: analysis.revision + 1,
  });
  await ctx.analysisRepository.updateStatus(analysis.id, "completed", { completedAt: new Date() });
  const updated = await ctx.analysisRepository.get(analysis.id);
  if (updated === null) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  await new AnalysisTaskMaterializer(ctx.taskRepository).materialize(updated);
  const tasks = await ctx.taskRepository.listByAnalysis(updated.id);
  sendJson({ res, rc, body: { status: "completed", result: mapAnalysisResult(updated, tasks) } });
};

function clarificationIndex(questionId: string): number | null {
  const match = /^clarification_(\d+)$/.exec(questionId);
  if (match?.[1] === undefined) {
    return null;
  }
  return Number(match[1]);
}
