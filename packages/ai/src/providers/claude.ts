/**
 * Provedor Claude (Anthropic) — implementação de referência do Atlas.
 *
 * Usa o SDK oficial `@anthropic-ai/sdk`.
 *
 * Três detalhes da API atual que o código respeita e que costumam
 * causar erro quando ignorados:
 *
 * 1. `temperature`, `top_p` e `top_k` FORAM REMOVIDOS nos modelos
 *    atuais (Opus 5, Opus 4.8/4.7, Sonnet 5). Enviar qualquer um
 *    deles devolve 400. Por isso o `temperature` do contrato genérico
 *    do Atlas é deliberadamente ignorado aqui — para orientar o estilo
 *    da resposta, use o prompt (`system`).
 *
 * 2. `stop_reason: "refusal"` chega como HTTP 200, não como exceção.
 *    Ler `content[0]` sem checar antes quebra a aplicação.
 *
 * 3. Os classificadores de segurança podem recusar uma requisição;
 *    o parâmetro `fallbacks` reexecuta automaticamente em um modelo
 *    alternativo, do lado do servidor.
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseAiProvider } from '../provider.js';
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProviderConfig,
  type AiProviderId,
} from '../types.js';

/**
 * Beta que habilita o fallback do lado do servidor.
 * Com `fallbacks: 'default'` a Anthropic escolhe o modelo substituto
 * conforme a categoria da recusa — não precisamos manter essa lista.
 */
const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Modelos que ainda aceitam parâmetros de amostragem (geração antiga). */
const MODELS_ACCEPTING_SAMPLING = /^claude-(3|haiku-4-5|opus-4-5|opus-4-6|sonnet-4-5|sonnet-4-6)/;

export class ClaudeProvider extends BaseAiProvider {
  readonly id: AiProviderId = 'claude';

  private readonly client: Anthropic;

  constructor(config: AiProviderConfig) {
    super(config);

    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      // Em ms no SDK TypeScript (em Python seria em segundos).
      timeout: config.timeoutMs ?? 60_000,
      maxRetries: 2,
    });
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();

    // A Anthropic trata a instrução de sistema em um parâmetro próprio,
    // e não como uma mensagem com role=system.
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));

    const systemFromMessages = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    const system = [request.system, systemFromMessages].filter(Boolean).join('\n\n');

    try {
      const params = {
        model: this.config.model,
        // Sem streaming, manter abaixo de ~16k evita timeout de HTTP.
        max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
        ...(system ? { system } : {}),
        messages,
        // Recusa por classificador é reexecutada automaticamente em
        // outro modelo, em vez de voltar como erro para o usuário.
        betas: [SERVER_SIDE_FALLBACK_BETA],
        fallbacks: 'default',
        ...this.samplingParams(request),
        // `fallbacks` ainda não está nos tipos do SDK (a tipagem fica
        // atrás da API). O campo é encaminhado como está no corpo.
      } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

      const response = await this.client.beta.messages.create(params);

      // Recusa chega com HTTP 200 — precisa ser checada antes do conteúdo.
      // `stop_details` também ainda não é tipado.
      if (response.stop_reason === 'refusal') {
        const details = (response as { stop_details?: { category?: string | null } }).stop_details;
        throw new AiProviderError(
          'A requisição foi recusada pelos classificadores de segurança ' +
            `(categoria: ${details?.category ?? 'desconhecida'})`,
          this.id,
          undefined,
          false,
        );
      }

      const content = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;

      return {
        content,
        // `response.model` traz quem realmente atendeu — pode ser o
        // modelo de fallback, e não o que pedimos.
        model: response.model,
        provider: this.id,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        finishReason: mapStopReason(response.stop_reason),
        latencyMs: Date.now() - startedAt,
        raw: response,
      };
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  /**
   * Só envia `temperature` para modelos que ainda aceitam parâmetros de
   * amostragem. Nos modelos atuais isso resultaria em erro 400.
   */
  private samplingParams(request: AiCompletionRequest): { temperature?: number } {
    if (request.temperature === undefined) return {};
    if (!MODELS_ACCEPTING_SAMPLING.test(this.config.model)) return {};
    return { temperature: request.temperature };
  }

  private toProviderError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) return error;

    // Classes tipadas do SDK — nunca comparar strings de mensagem.
    if (error instanceof Anthropic.RateLimitError) {
      return new AiProviderError('Limite de requisições atingido', this.id, 429, true, {
        cause: error,
      });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return new AiProviderError('Chave de API inválida', this.id, 401, false, { cause: error });
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new AiProviderError('Falha de conexão com a API', this.id, undefined, true, {
        cause: error,
      });
    }
    if (error instanceof Anthropic.APIError) {
      const status = error.status ?? 500;
      return new AiProviderError(error.message, this.id, status, status >= 500, { cause: error });
    }

    return new AiProviderError('Erro inesperado no provedor', this.id, undefined, false, {
      cause: error,
    });
  }
}

function mapStopReason(reason: string | null): AiCompletionResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content_filter';
    default:
      return 'unknown';
  }
}
