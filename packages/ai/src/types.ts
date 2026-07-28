/** Tipos da camada de IA — vocabulário comum a todos os provedores. */

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiCompletionRequest {
  messages: AiMessage[];
  /**
   * Instrução de sistema. Mantida separada de `messages` porque os
   * provedores a tratam de formas diferentes: a Anthropic usa um
   * parâmetro `system` dedicado; a OpenAI usa uma mensagem com
   * role=system. O adapter de cada um faz a conversão.
   */
  system?: string;
  maxTokens?: number;
  /** 0 = determinístico, 1 = criativo. Relatórios usam valores baixos. */
  temperature?: number;
  /** Pede resposta em JSON válido, quando o provedor suportar. */
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Custo estimado em USD, quando a tabela de preços é conhecida. */
  estimatedCostUsd?: number;
}

export interface AiCompletionResponse {
  content: string;
  model: string;
  provider: AiProviderId;
  usage: AiUsage;
  /** Motivo da parada, normalizado entre provedores. */
  finishReason: 'stop' | 'length' | 'content_filter' | 'error' | 'unknown';
  latencyMs: number;
  raw?: unknown;
}

export type AiProviderId = 'claude' | 'openai' | 'gemini';

export interface AiProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Sobrescreve o endpoint — útil para proxy corporativo ou testes. */
  baseUrl?: string;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: AiProviderId,
    readonly statusCode?: number,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiProviderError';
  }
}
