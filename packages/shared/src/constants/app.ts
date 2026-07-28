/** Identidade e constantes globais do Atlas. */

export const APP_NAME = 'Atlas' as const;
export const APP_MOBILE_NAME = 'Atlas App' as const;
export const APP_WEB_URL = 'https://atlas.vercel.app' as const;
export const APP_DEEP_LINK_SCHEME = 'atlasapp' as const;

/** Fuso oficial do produto — toda agregação por "dia" usa este fuso. */
export const APP_TIMEZONE = 'America/Sao_Paulo' as const;

export const DEFAULT_LOCALE = 'pt-BR' as const;
export const SUPPORTED_LOCALES = ['pt-BR', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Meta diária de água padrão, em mililitros, quando o usuário ainda
 * não definiu a sua. Referência comum de 35 ml/kg para ~70 kg.
 */
export const DEFAULT_DAILY_WATER_GOAL_ML = 2450;

/** Limites de paginação da API. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Header que carrega o identificador do dispositivo nas rotas de sync. */
export const DEVICE_ID_HEADER = 'x-atlas-device-id' as const;
/** Header com a assinatura HMAC dos webhooks trocados com o n8n. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-atlas-signature' as const;
