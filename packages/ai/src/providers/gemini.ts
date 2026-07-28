/**
 * Provedor Google Gemini.
 *
 * Implementado sobre `fetch` (generateContent), pelo mesmo motivo do
 * provedor OpenAI: a superfície usada é pequena.
 */

import { BaseAiProvider } from '../provider.js';
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProviderConfig,
  type AiProviderId,
} from '../types.js';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiProvider extends BaseAiProvider {
  readonly id: AiProviderId = 'gemini';

  constructor(config: AiProviderConfig) {
    super(config);
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();
    const baseUrl = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';

    // O Gemini usa "model" onde os outros usam "assistant", e a
    // instrução de sistema vai em `systemInstruction`.
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    const response = await this.fetchWithTimeout(
      `${baseUrl}/models/${this.config.model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Chave em header — evita que ela apareça em log de URL.
          'x-goog-api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          contents,
          ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
          generationConfig: {
            maxOutputTokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
            temperature: request.temperature ?? 0.7,
            ...(request.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
      request.timeoutMs ?? this.config.timeoutMs ?? 60_000,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new AiProviderError(
        `Gemini respondeu ${response.status}: ${body.slice(0, 500)}`,
        this.id,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';

    return {
      content,
      model: this.config.model,
      provider: this.id,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
      finishReason: mapFinishReason(candidate?.finishReason ?? null),
      latencyMs: Date.now() - startedAt,
      raw: data,
    };
  }
}

function mapFinishReason(reason: string | null): AiCompletionResponse['finishReason'] {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter';
    default:
      return 'unknown';
  }
}
