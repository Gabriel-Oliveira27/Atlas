/**
 * Contrato que todo provedor de IA implementa (padrão Strategy).
 *
 * Só existem dois métodos porque é tudo de que o Atlas precisa hoje:
 * completar texto e checar disponibilidade. Manter a interface
 * mínima é o que permite adicionar um provedor novo sem tocar em
 * nenhum consumidor.
 */

import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiProviderConfig,
  AiProviderId,
} from './types.js';

export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;

  /** Executa uma completude de texto. */
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;

  /** Verifica se o provedor está configurado e alcançável. */
  healthCheck(): Promise<boolean>;
}

/**
 * Base compartilhada: timeout, montagem de erro e extração de JSON.
 * Cada provedor implementa apenas o que é específico dele.
 */
export abstract class BaseAiProvider implements AiProvider {
  abstract readonly id: AiProviderId;

  protected constructor(protected readonly config: AiProviderConfig) {
    if (!config.apiKey) {
      throw new Error(`Chave de API ausente para o provedor de IA`);
    }
  }

  get model(): string {
    return this.config.model;
  }

  abstract complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.complete({
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 8,
        timeoutMs: 10_000,
      });
      return response.content.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Executa o fetch com timeout via AbortController.
   * Sem isso, uma chamada travada seguraria um worker da fila
   * indefinidamente.
   */
  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Extrai JSON de uma resposta que pode vir embrulhada em
   * ```json ... ``` ou acompanhada de texto explicativo — comportamento
   * comum mesmo quando se pede JSON puro.
   */
  static extractJson<T = unknown>(content: string): T {
    const trimmed = content.trim();

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced?.[1]?.trim() ?? trimmed;

    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Última tentativa: primeiro objeto/array balanceado do texto.
      const start = candidate.search(/[[{]/);
      const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
      if (start !== -1 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      }
      throw new Error('A resposta da IA não contém JSON válido');
    }
  }
}
