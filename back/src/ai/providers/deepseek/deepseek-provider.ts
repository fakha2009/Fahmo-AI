import { AppError } from "../../../shared/errors";
import { DeepSeekResponseSchema } from "../../schemas/deepseek-response";
import {
  buildDocumentPrompt,
  buildTextPrompt,
  clarificationSystemPrompt,
  simplifySystemPrompt,
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

export class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {
    if (config.name !== "deepseek") {
      throw new Error(`DeepSeekProvider ожидает конфиг name="deepseek", получено "${config.name}"`);
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
    const pages = input.pages.map((page) =>
      typeof page.content === "string"
        ? page.content
        : Buffer.from(page.content).toString("utf8")
    );
    return this.chat(
      input,
      "analyze_document",
      buildDocumentPrompt(input.language, {
        documentType: input.promptDocumentType ?? null,
        version: input.promptVersion ?? null,
      }),
      pages.join("\n\n")
    );
  }

  async analyzeText(input: AnalyzeTextInput): Promise<ProviderRawResult> {
    return this.chat(input, "analyze_text", buildTextPrompt(input.language), input.text);
  }

  async answerClarification(input: AnswerClarificationInput): Promise<ProviderRawResult> {
    const context = JSON.stringify(input.previousResult);
    const userMessage = [
      `Текущий результат анализа:\n${context}`,
      `Вопрос: ${input.question.question}`,
      `Ответ пользователя: ${input.answer}`,
    ].join("\n");
    return this.chat(input, "answer_clarification", clarificationSystemPrompt(input.language), userMessage);
  }

  async simplifyResult(input: SimplifyResultInput): Promise<ProviderRawResult> {
    return this.chat(
      input,
      "simplify_result",
      simplifySystemPrompt(input.language, input.audience),
      JSON.stringify(input.previousResult)
    );
  }

  private async chat(
    input: { signal?: AbortSignal },
    operation: AiOperation,
    systemPrompt: string,
    userMessage: string
  ): Promise<ProviderRawResult> {
    const startedAt = Date.now();
    const endpoint = `${this.config.baseUrl}/chat/completions`;
    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          stream: false,
        }),
        signal: input.signal,
      });
    } catch (error) {
      throw this.mapNetworkError(error, input.signal);
    }
    if (!response.ok) {
      throw await this.mapHttpError(response);
    }
    const parsed = DeepSeekResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new AppError({
        code: "AI_INVALID_RESPONSE",
        message: "Некорректная структура ответа DeepSeek",
        details: parsed.error.flatten(),
      });
    }
    const content = parsed.data.choices[0]?.message?.content ?? "";
    return {
      providerName: this.name,
      model: this.config.model,
      operation,
      content,
      inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
      providerRequestId: parsed.data.id ?? null,
      finishedAt: new Date(),
    };
  }

  private mapNetworkError(error: unknown, signal: AbortSignal | undefined): AppError {
    if (signal?.aborted) {
      return new AppError({
        code: "AI_PROVIDER_TIMEOUT",
        message: "Превышен таймаут ожидания ответа DeepSeek",
        retryable: true,
        cause: error,
      });
    }
    return new AppError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "DeepSeek недоступен",
      retryable: true,
      cause: error,
    });
  }

  private async mapHttpError(response: Response): Promise<AppError> {
    if (response.status === 429) {
      return new AppError({
        code: "RATE_LIMITED",
        message: "Превышен лимит запросов DeepSeek",
        retryable: true,
        params: { status: response.status },
      });
    }
    if (response.status >= 500) {
      return new AppError({
        code: "AI_PROVIDER_UNAVAILABLE",
        message: "DeepSeek недоступен",
        retryable: true,
        params: { status: response.status },
      });
    }
    return new AppError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "Запрос к DeepSeek отклонён",
      retryable: false,
      params: { status: response.status },
    });
  }
}
