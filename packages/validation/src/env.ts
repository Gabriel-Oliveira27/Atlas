/**
 * Schema das variáveis de ambiente da API.
 *
 * Validado no boot: se faltar algo essencial, o processo falha
 * imediatamente com mensagem clara — em vez de quebrar mais tarde,
 * em produção, no meio de uma requisição.
 */

import { z } from 'zod';

/** Aceita "true"/"1" (e variações) como booleano verdadeiro. */
const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['true', '1', 'yes'].includes(value.toLowerCase()),
  );

const postgresUrlSchema = z
  .string()
  .refine((url) => url.startsWith('postgres://') || url.startsWith('postgresql://'), {
    message: 'Deve ser uma connection string PostgreSQL (postgres:// ou postgresql://)',
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    TZ: z.string().default('America/Sao_Paulo'),

    /** Identifica este nó nas trilhas de sincronização (ChangeLog.originNode). */
    NODE_ID: z.string().min(1).default('local-dev-01'),

    // ── Bancos ────────────────────────────────────────────────
    DATABASE_URL_LOCAL: postgresUrlSchema,
    /**
     * O Neon é opcional em desenvolvimento: dá para trabalhar só com o
     * banco local. Vazio desliga o failover e a sincronização com a nuvem.
     */
    DATABASE_URL_CLOUD: z
      .union([postgresUrlSchema, z.literal('')])
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    SHADOW_DATABASE_URL: z.string().optional(),
    /**
     * Qual banco atende quando os dois respondem.
     *
     * O padrão é CLOUD desde 29/07/2026. O Atlas nasceu LOCAL — ver
     * ADR 003 e a emenda no ADR 008 — mas o notebook desliga, e com ele
     * saía o produto: o app aponta para a máquina de casa e ficava sem
     * back-end. O Neon está sempre de pé, então virou o principal.
     *
     * LOCAL continua válido e é o que faz sentido numa instalação com
     * Postgres na mesma rede dos usuários (latência de milissegundos).
     */
    DATABASE_PRIMARY: z.enum(['LOCAL', 'CLOUD']).default('CLOUD'),
    DATABASE_HEALTHCHECK_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
    DATABASE_HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().min(500).default(3_000),

    // ── Redis ─────────────────────────────────────────────────
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    REDIS_PREFIX: z.string().default('atlas'),

    // ── API ───────────────────────────────────────────────────
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
    API_HOST: z.string().default('0.0.0.0'),
    API_PREFIX: z.string().default('api'),
    API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),
    /**
     * Allowlist de origens. 3000/3001 = app web, 3002 = painel admin.
     * Uma origem que falta aqui é bloqueada pelo navegador com um erro
     * de CORS que não menciona esta variável — vale conferir aqui antes
     * de procurar no front.
     *
     * Aceita curinga em um rótulo do host: `https://*.vercel.app` cobre
     * os deploys de preview, que ganham domínio novo a cada branch, e
     * `https://*.trycloudflare.com` cobre o túnel de desenvolvimento,
     * cujo subdomínio é sorteado a cada execução. A comparação é por
     * rótulo — ver `apps/api/src/config/cors.ts`.
     */
    CORS_ORIGINS: z
      .string()
      .default(
        'http://localhost:3000,http://localhost:3001,http://localhost:3002,https://*.vercel.app,https://*.trycloudflare.com',
      )
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    /**
     * Libera origens da rede local (192.168.x, 10.x, 172.16–31.x).
     *
     * É o que permite abrir o web pelo celular no mesmo Wi-Fi sem
     * cadastrar o IP — que muda quando o roteador renova o DHCP.
     *
     * O padrão segue o ambiente: ligado em desenvolvimento, desligado em
     * produção. Num servidor, uma origem "privada" não é o seu notebook,
     * é outra máquina do datacenter.
     */
    CORS_ALLOW_LAN: z.enum(['true', 'false']).optional(),

    /**
     * Credenciais da documentação (`/docs`).
     *
     * Quando preenchidas, o Swagger passa a exigir Basic Auth — inclusive
     * fora de produção. É o que permite deixar o `/docs` acessível pelo
     * túnel sem publicar o mapa completo da API para qualquer um.
     *
     * Em produção o `/docs` só é servido SE estas existirem; sem elas,
     * fica desligado em vez de aberto.
     */
    DOCS_USER: z.string().min(1).optional(),
    DOCS_PASSWORD: z.string().min(8, 'Senha da documentação muito curta').optional(),

    // ── JWT ───────────────────────────────────────────────────
    JWT_ACCESS_SECRET: z.string().min(16, 'Segredo do access token muito curto'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(16, 'Segredo do refresh token muito curto'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    JWT_ISSUER: z.string().default('atlas'),
    JWT_AUDIENCE: z.string().default('atlas-clients'),

    // ── Google OAuth (opcional em dev) ────────────────────────
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().url().default('http://localhost:3333/api/auth/google/callback'),
    OAUTH_SUCCESS_REDIRECT_WEB: z.string().default('http://localhost:3000/auth/callback'),
    OAUTH_SUCCESS_REDIRECT_MOBILE: z.string().default('atlasapp://auth/callback'),
    OAUTH_FAILURE_REDIRECT: z.string().default('http://localhost:3000/auth/error'),

    // ── Cloudinary (opcional em dev) ──────────────────────────
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_FOLDER: z.string().default('atlas'),

    // ── n8n ───────────────────────────────────────────────────
    N8N_BASE_URL: z.string().url().default('http://localhost:5678'),
    N8N_WEBHOOK_SECRET: z.string().min(8).default('troque-este-segredo-de-webhook'),

    // ── IA ────────────────────────────────────────────────────
    AI_ENABLED: booleanFromString.default(false),
    AI_PROVIDER: z.enum(['claude', 'openai', 'gemini']).default('claude'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-1.5-pro'),
    AI_MAX_TOKENS: z.coerce.number().int().min(256).default(4096),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),

    // ── Sincronização ─────────────────────────────────────────
    SYNC_ENABLED: booleanFromString.default(true),
    SYNC_CRON_MORNING: z.string().default('0 3 * * *'),
    SYNC_CRON_EVENING: z.string().default('0 18 * * *'),
    SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(500),
    SYNC_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
    SYNC_RETRY_BACKOFF_MS: z.coerce.number().int().min(100).default(5_000),

    // ── Retenção do rastro da sincronização ───────────────────
    // O que cresce sem limite nos dois bancos não é o histórico do
    // usuário (datas e inteiros, poucas centenas de bytes por linha, e
    // as fotos ficam no Cloudinary) — é o rastro do próprio motor:
    // `ChangeLog` guarda uma cópia JSON INTEGRAL da linha a cada
    // escrita, e nada nunca podava. Mais `SyncRun` e `SyncConflict` já
    // resolvido.
    //
    // Estas três tabelas não estão em SYNC_ENTITIES, então apagá-las não
    // gera outbox novo — a poda não se propaga como se fosse uma
    // exclusão de dado do usuário.
    SYNC_RETENTION_ENABLED: z.coerce.boolean().default(true),
    /**
     * Idade mínima para podar. Só alcança entrada já SYNCED, execução já
     * encerrada e conflito já resolvido — nada pendente é tocado, em
     * nenhuma idade.
     */
    SYNC_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    SYNC_RETENTION_CRON: z.string().default('30 4 * * *'),

    // ── Rate limit / logs ─────────────────────────────────────
    // O limite padrão vale para leituras. As famílias abaixo cobrem as
    // rotas cujo custo é diferente — apertar qualquer uma sob ataque não
    // deveria exigir deploy. Ver `apps/api/src/config/throttle.config.ts`.
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),

    /** Autenticação — alvo de força bruta. */
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_AUTH_TTL_MS: z.coerce.number().int().min(1000).default(60_000),

    /** Sincronização — cargas grandes, custo alto por requisição. */
    RATE_LIMIT_SYNC_MAX: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_SYNC_TTL_MS: z.coerce.number().int().min(1000).default(60_000),

    /** IA — cada chamada custa dinheiro real ao provedor. */
    RATE_LIMIT_AI_MAX: z.coerce.number().int().min(1).default(5),
    RATE_LIMIT_AI_TTL_MS: z.coerce.number().int().min(1000).default(3_600_000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  /**
   * `CORS_ALLOW_LAN` é opcional no ambiente e resolvido aqui: quem não
   * definir nada ganha o comportamento seguro por padrão — liberado em
   * desenvolvimento, bloqueado em produção. Deixar o default no campo
   * não daria acesso ao `NODE_ENV`.
   */
  .transform((env) => ({
    ...env,
    CORS_ALLOW_LAN: env.CORS_ALLOW_LAN
      ? env.CORS_ALLOW_LAN === 'true'
      : env.NODE_ENV !== 'production',
  }))
  // Em produção não se aceita rodar com os segredos de exemplo.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.JWT_ACCESS_SECRET.includes('dev-only') || env.JWT_ACCESS_SECRET.includes('troque')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'Defina um JWT_ACCESS_SECRET real em produção',
      });
    }
    if (env.JWT_REFRESH_SECRET.includes('dev-only') || env.JWT_REFRESH_SECRET.includes('troque')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Defina um JWT_REFRESH_SECRET real em produção',
      });
    }
    if (!env.DATABASE_URL_CLOUD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL_CLOUD'],
        message: 'O banco Neon é obrigatório em produção (redundância e backup)',
      });
    }

    /**
     * `DATABASE_URL_LOCAL` é o datasource do Prisma — o nome vem do
     * ambiente de desenvolvimento, onde ele aponta para o Postgres do
     * docker-compose. Num serviço hospedado NÃO existe esse Postgres, e
     * copiar o valor do `.env` é o erro natural de quem vê o nome.
     *
     * O sintoma sem esta trava é ruim de diagnosticar: a API sobe, o
     * health check falha por timeout e o deploy é derrubado com
     * "service unhealthy", sem dizer que o banco é inalcançável.
     */
    if (/@(localhost|127\.0\.0\.1|::1|host\.docker\.internal)[:/]/.test(env.DATABASE_URL_LOCAL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL_LOCAL'],
        message:
          'Em produção esta variável não pode apontar para localhost — não existe Postgres na máquina do serviço. ' +
          'Use a MESMA string do Neon que está em DATABASE_URL_CLOUD.',
      });
    }
  });

export type AtlasEnv = z.infer<typeof envSchema>;

/**
 * Valida `process.env` e devolve a configuração tipada.
 * Lança erro com a lista completa de problemas quando algo falta.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): AtlasEnv {
  /**
   * Hospedagens (Render, Railway, Fly, Heroku) escolhem a porta e a
   * injetam em `PORT`. A API lê `API_PORT` — sem esta ponte ela subiria
   * na 3333, o serviço não responderia ao health check e o deploy seria
   * derrubado por "no open ports detected", que não diz o que houve.
   *
   * `API_PORT` explícito continua tendo precedência: quem definiu quis.
   */
  const normalized: NodeJS.ProcessEnv =
    !source.API_PORT && source.PORT ? { ...source, API_PORT: source.PORT } : source;

  const result = envSchema.safeParse(normalized);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }

  return result.data;
}
