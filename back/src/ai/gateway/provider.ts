import type { OutputLanguage } from "../../validation/common";

export type AiOperation =
  | "analyze_document"
  | "analyze_text"
  | "answer_clarification"
  | "simplify_result";

export type AiInputType = "image" | "pdf" | "text";

export interface AiPage {
  index: number;
  kind: "image" | "text";
  mimeType: string | null;
  content: string | Uint8Array;
}

export interface AiCallContext {
  analysisId: string | null;
  language: OutputLanguage;
  signal?: AbortSignal;
  preferLowLatency?: boolean;
  preferLowCost?: boolean;
  preferredProvider?: string | null;
  promptDocumentType?: string | null;
  promptVersion?: string | null;
}

export interface AnalyzeDocumentInput extends AiCallContext {
  pages: AiPage[];
  inputType: "image" | "pdf";
}

export interface AnalyzeTextInput extends AiCallContext {
  text: string;
}

export interface AnswerClarificationInput extends AiCallContext {
  question: {
    fieldPath: string;
    question: string;
    suggestedAnswers: string[];
  };
  answer: string;
  previousResult: unknown;
}

export interface SimplifyResultInput extends AiCallContext {
  previousResult: unknown;
  audience: "child" | "elder" | "general";
}

export interface ProviderRawResult {
  providerName: string;
  model: string;
  operation: AiOperation;
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  providerRequestId: string | null;
  finishedAt: Date;
}

export interface ProviderCapabilities {
  name: string;
  available: boolean;
  supportedInputs: AiInputType[];
  supportedLanguages: OutputLanguage[];
  maxInputPages: number;
  maxInputBytes: number;
  maxOutputChars: number;
}

export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  costPerMillionInput: number;
  costPerMillionOutput: number;
  supportedInputs: AiInputType[];
  supportedLanguages: OutputLanguage[];
  maxInputPages: number;
  maxInputBytes: number;
  maxOutputChars: number;
}

export interface AIProvider {
  readonly name: string;
  getCapabilities(): ProviderCapabilities;
  analyzeDocument(input: AnalyzeDocumentInput): Promise<ProviderRawResult>;
  analyzeText(input: AnalyzeTextInput): Promise<ProviderRawResult>;
  answerClarification(input: AnswerClarificationInput): Promise<ProviderRawResult>;
  simplifyResult(input: SimplifyResultInput): Promise<ProviderRawResult>;
}
