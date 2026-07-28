/**
 * Configuração tipada da API.
 *
 * Usa o schema Zod compartilhado (`@atlas/validation`) em vez do
 * `ConfigModule` cru do Nest: o mesmo contrato de ambiente vale para a
 * API, os scripts e o CI, e o erro de configuração aparece no boot.
 */

import { Injectable } from '@nestjs/common';
import { parseEnv, type AtlasEnv } from '@atlas/validation';

@Injectable()
export class EnvConfig {
  private readonly env: AtlasEnv;

  constructor() {
    this.env = parseEnv();
  }

  get all(): AtlasEnv {
    return this.env;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get nodeId(): string {
    return this.env.NODE_ID;
  }

  get database() {
    return {
      localUrl: this.env.DATABASE_URL_LOCAL,
      cloudUrl: this.env.DATABASE_URL_CLOUD,
      primary: this.env.DATABASE_PRIMARY,
      healthCheckIntervalMs: this.env.DATABASE_HEALTHCHECK_INTERVAL_MS,
      healthCheckTimeoutMs: this.env.DATABASE_HEALTHCHECK_TIMEOUT_MS,
      logQueries: this.env.NODE_ENV === 'development',
    };
  }

  get redis() {
    return { url: this.env.REDIS_URL, prefix: this.env.REDIS_PREFIX };
  }

  get jwt() {
    return {
      accessSecret: this.env.JWT_ACCESS_SECRET,
      refreshSecret: this.env.JWT_REFRESH_SECRET,
      accessTtl: this.env.JWT_ACCESS_TTL,
      refreshTtl: this.env.JWT_REFRESH_TTL,
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
    };
  }

  get google() {
    return {
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: this.env.GOOGLE_CALLBACK_URL,
      successRedirectWeb: this.env.OAUTH_SUCCESS_REDIRECT_WEB,
      successRedirectMobile: this.env.OAUTH_SUCCESS_REDIRECT_MOBILE,
      failureRedirect: this.env.OAUTH_FAILURE_REDIRECT,
      /** OAuth só é ativado quando as credenciais existem. */
      isConfigured: Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET),
    };
  }

  get cloudinary() {
    return {
      cloudName: this.env.CLOUDINARY_CLOUD_NAME,
      apiKey: this.env.CLOUDINARY_API_KEY,
      apiSecret: this.env.CLOUDINARY_API_SECRET,
      folder: this.env.CLOUDINARY_FOLDER,
      isConfigured: Boolean(
        this.env.CLOUDINARY_CLOUD_NAME &&
        this.env.CLOUDINARY_API_KEY &&
        this.env.CLOUDINARY_API_SECRET,
      ),
    };
  }

  get ai() {
    return {
      enabled: this.env.AI_ENABLED,
      defaultProvider: this.env.AI_PROVIDER,
      maxTokens: this.env.AI_MAX_TOKENS,
      timeoutMs: this.env.AI_TIMEOUT_MS,
      providers: {
        claude: {
          apiKey: this.env.ANTHROPIC_API_KEY ?? '',
          model: this.env.ANTHROPIC_MODEL,
          maxTokens: this.env.AI_MAX_TOKENS,
          timeoutMs: this.env.AI_TIMEOUT_MS,
        },
        openai: {
          apiKey: this.env.OPENAI_API_KEY ?? '',
          model: this.env.OPENAI_MODEL,
          maxTokens: this.env.AI_MAX_TOKENS,
          timeoutMs: this.env.AI_TIMEOUT_MS,
        },
        gemini: {
          apiKey: this.env.GEMINI_API_KEY ?? '',
          model: this.env.GEMINI_MODEL,
          maxTokens: this.env.AI_MAX_TOKENS,
          timeoutMs: this.env.AI_TIMEOUT_MS,
        },
      },
    };
  }

  get sync() {
    return {
      enabled: this.env.SYNC_ENABLED,
      cronMorning: this.env.SYNC_CRON_MORNING,
      cronEvening: this.env.SYNC_CRON_EVENING,
      batchSize: this.env.SYNC_BATCH_SIZE,
      maxRetries: this.env.SYNC_MAX_RETRIES,
      retryBackoffMs: this.env.SYNC_RETRY_BACKOFF_MS,
    };
  }

  get n8n() {
    return { baseUrl: this.env.N8N_BASE_URL, webhookSecret: this.env.N8N_WEBHOOK_SECRET };
  }

  get rateLimit() {
    return { ttlSeconds: this.env.RATE_LIMIT_TTL_SECONDS, max: this.env.RATE_LIMIT_MAX };
  }
}
