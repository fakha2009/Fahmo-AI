import { AppError } from "../../../shared/errors";
import { GeminiResponseSchema } from "../../schemas/gemini-response";
import {
  buildDocumentPrompt,
  buildTextPrompt,
  simplifySystemPrompt,
  clarificationSystemPrompt,
} from "../../prompts";
import type {
  AIProvider,
  AnalyzeDocumentInput,
  AnalyzeTextInput,
  AnswerClarificationInput,
  ProviderCapabilities,
  ProviderConfig,
  ProviderRawResult,
  SimplifyResultInput,
} from "../../gateway/provider";
import type { AiOperation } from "../../gateway/provider";

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {
    if (config.name !== "gemini") {
      throw new Error(`GeminiProvider ожидает конфиг name="gemini", получено "${config.name}"`);
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      name: this.name,
      available: this.config.enabled && this.config.apiKey.length > 0,
      supportedInputs: this.config.supportedInputs,
      supportedLanguages: this.config.supportedLanguages,
      maxInputPages: this.config.maxInputPages,
      maxInputBytes: this.config.maxInputBytes,
      maxOutputChars: this.config.maxOutputChars,
    };
  }

  async analyzeDocument(input: AnalyzeDocumentInput): Promise<ProviderRawResult> {
    const parts: GeminiPart[] = [
      {
        text: buildDocumentPrompt(input.language, {
          documentType: input.promptDocumentType ?? null,
          version: input.promptVersion ?? null,
        }),
      },
    ];
    for (const page of input.pages) {
      if (page.kind === "image") {
        const bytes =
          typeof page.content === "string" ? Buffer.from(page.content, "utf8") : Buffer.from(page.content);
        parts.push({
          inlineData: { mimeType: page.mimeType ?? "image/jpeg", data: bytes.toString("base64") },
        });
      } else {
        parts.push({ text: typeof page.content === "string" ? page.content : Buffer.from(page.content).toString("utf8") });
      }
    }
    return this.generate(input, "analyze_document", parts);
  }

  async analyzeText(input: AnalyzeTextInput): Promise<ProviderRawResult> {
    return this.generate(input, "analyze_text", [
      { text: buildTextPrompt(input.language) },
      { text: input.text },
    ]);
  }

  async answerClarification(input: AnswerClarificationInput): Promise<ProviderRawResult> {
    const context = JSON.stringify(input.previousResult);
    const question = input.question.question;
    return this.generate(input, "answer_clarification", [
      { text: clarificationSystemPrompt(input.language) },
      {
        text: [
          `Текущий результат анализа:\n${context}`,
          `Вопрос: ${question}`,
          `Ответ пользователя: ${input.answer}`,
        ].join("\n"),
      },
    ]);
  }

  async simplifyResult(input: SimplifyResultInput): Promise<ProviderRawResult> {
    return this.generate(input, "simplify_result", [
      { text: simplifySystemPrompt(input.language, input.audience) },
      { text: JSON.stringify(input.previousResult) },
    ]);
  }

  private async generate(
    input: { signal?: AbortSignal },
    operation: AiOperation,
    parts: GeminiPart[]
  ): Promise<ProviderRawResult> {
    const startedAt = Date.now();
    const endpoint = `${this.config.baseUrl}/models/${this.config.model}:generateContent`;
    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: input.signal,
      });
    } catch (error) {
      throw this.mapNetworkError(error, input.signal);
    }
    if (!response.ok) {
      throw await this.mapHttpError(response);
    }
    const parsed = GeminiResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new AppError({
        code: "AI_INVALID_RESPONSE",
        message: "Некорректная структура ответа Gemini",
        details: parsed.error.flatten(),
      });
    }
    const text = parsed.data.candidates
      .flatMap((candidate) => candidate.content.parts.map((part) => part.text))
      .join("");
    return {
      providerName: this.name,
      model: this.config.model,
      operation,
      content: text,
      inputTokens: parsed.data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: parsed.data.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - startedAt,
      providerRequestId: null,
      finishedAt: new Date(),
    };
  }

  private mapNetworkError(error: unknown, signal: AbortSignal | undefined): AppError {
    if (signal?.aborted) {
      return new AppError({
        code: "AI_PROVIDER_TIMEOUT",
        message: "Превышен таймаут ожидания ответа Gemini",
        retryable: true,
        cause: error,
      });
    }
    return new AppError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "Gemini недоступен",
      retryable: true,
      cause: error,
    });
  }

  private async mapHttpError(response: Response): Promise<AppError> {
    if (response.status === 429) {
      return new AppError({
        code: "RATE_LIMITED",
        message: "Превышен лимит запросов Gemini",
        retryable: true,
        params: { status: response.status },
      });
    }
    if (response.status >= 500) {
      return new AppError({
        code: "AI_PROVIDER_UNAVAILABLE",
        message: "Gemini недоступен",
        retryable: true,
        params: { status: response.status },
      });
    }
    return new AppError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "Запрос к Gemini отклонён",
      retryable: false,
      params: { status: response.status },
    });
  }
}
