/**
 * Provedor OpenAI.
 *
 * Implementado sobre `fetch` (Chat Completions) para não adicionar mais
 * um SDK ao bundle — a superfície usada pelo Atlas é uma única rota.
 * Se o uso crescer (streaming, function calling, assistants), vale
 * migrar para o SDK oficial `openai`.
 */

import { BaseAiProvider } from '../provider.js';
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProviderConfig,
  type AiProviderId,
} from '../types.js';

interface OpenAiChatResponse {
  model: string;
  choices: Array<{
    message: { content: string | null };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAiProvider extends BaseAiProvider {
  readonly id: AiProviderId = 'openai';

  constructor(config: AiProviderConfig) {
    super(config);
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';

    // Na OpenAI a instrução de sistema é a primeira mensagem da lista.
    const messages = [
      ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
      ...request.messages.map((message) => ({ role: message.role, content: message.content })),
    ];

    const response = await this.fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
          temperature: request.temperature ?? 0.7,
          ...(request.responseFormat === 'json'
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
      },
      request.timeoutMs ?? this.config.timeoutMs ?? 60_000,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new AiProviderError(
        `OpenAI respondeu ${response.status}: ${body.slice(0, 500)}`,
        this.id,
        response.status,
        // 429 e 5xx valem retry; 4xx restantes indicam erro de requisição.
        response.status === 429 || response.status >= 500,
      );
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const choice = data.choices[0];

    return {
      content: choice?.message.content ?? '',
      model: data.model,
      provider: this.id,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: mapFinishReason(choice?.finish_reason ?? null),
      latencyMs: Date.now() - startedAt,
      raw: data,
    };
  }
}

function mapFinishReason(reason: string | null): AiCompletionResponse['finishReason'] {
  switch (reason) {
    case 'stop':
    case 'tool_calls':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}
