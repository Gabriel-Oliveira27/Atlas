/**
 * Factory de provedores de IA.
 *
 * É o único ponto do sistema que sabe quais provedores existem.
 * Adicionar um novo provedor = implementar `AiProvider` + registrar
 * aqui; nenhum consumidor muda.
 */

import type { AiProvider } from './provider.js';
import { ClaudeProvider } from './providers/claude.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAiProvider } from './providers/openai.js';
import type { AiProviderConfig, AiProviderId } from './types.js';

export interface AiFactoryConfig {
  /** Provedor usado quando a chamada não especifica um. */
  defaultProvider: AiProviderId;
  /** Quando falso, `createProvider` lança — a IA está desligada. */
  enabled: boolean;
  providers: Partial<Record<AiProviderId, AiProviderConfig>>;
}

export function createAiProvider(config: AiFactoryConfig, providerId?: AiProviderId): AiProvider {
  if (!config.enabled) {
    throw new Error('A camada de IA está desabilitada (AI_ENABLED=false)');
  }

  const id = providerId ?? config.defaultProvider;
  const providerConfig = config.providers[id];

  if (!providerConfig?.apiKey) {
    throw new Error(
      `Provedor de IA "${id}" não configurado — defina a chave de API correspondente no .env`,
    );
  }

  switch (id) {
    case 'claude':
      return new ClaudeProvider(providerConfig);
    case 'openai':
      return new OpenAiProvider(providerConfig);
    case 'gemini':
      return new GeminiProvider(providerConfig);
    default: {
      // Garante em tempo de compilação que todo provedor foi tratado.
      const exhaustive: never = id;
      throw new Error(`Provedor de IA desconhecido: ${String(exhaustive)}`);
    }
  }
}

/** Provedores que possuem chave configurada. */
export function availableProviders(config: AiFactoryConfig): AiProviderId[] {
  return (Object.keys(config.providers) as AiProviderId[]).filter((id) =>
    Boolean(config.providers[id]?.apiKey),
  );
}
