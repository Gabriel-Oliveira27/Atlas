/**
 * Montagem da aplicação, compartilhada por quem a sobe.
 *
 * São dois hoje: `main.ts`, que escuta uma porta (notebook e Render), e
 * `api/index.ts`, que atende como função serverless na Vercel. Os dois
 * precisam de EXATAMENTE a mesma configuração — helmet, CORS, prefixo,
 * envelope de resposta, tradução de erro.
 *
 * Estar aqui não é organização: é o que impede os dois de divergirem.
 * Duplicado, o primeiro cabeçalho de segurança acrescentado num deles
 * vale só num ambiente, e a diferença aparece em produção.
 */

import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import type { AtlasEnv } from '@atlas/validation';
import { APP_NAME } from '@atlas/shared';
import { buildCorsOrigin } from './config/cors.js';
import { buildDocsGuard } from './config/docs-auth.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { HttpMetricsInterceptor } from './common/interceptors/http-metrics.interceptor.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';

export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    // O proxy à frente da API (Vercel/Nginx) define X-Forwarded-*;
    // sem isto, o rate limit veria o IP do proxy para todo mundo.
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10 MB (uploads passam pelo Cloudinary)

    /**
     * Identificador da requisição, definido no ponto MAIS CEDO
     * possível para que o envelope da resposta, o log e o header
     * carreguem o mesmo valor.
     *
     * Escrever de volta em `headers['x-request-id']` não é enfeite: é
     * como o logger (que recebe a requisição crua, sem acesso a
     * `request.id` do Fastify) chega ao mesmo id. Sem isso, o log e a
     * resposta teriam ids diferentes — e correlacionar os dois é a
     * única razão de existir do campo.
     */
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const incoming = req.headers['x-request-id'];
      const requestId =
        (Array.isArray(incoming) ? incoming[0] : incoming)?.slice(0, 128) || randomUUID();

      req.headers['x-request-id'] = requestId;
      return requestId;
    },
  });
}

/** A documentação foi montada? Quem sobe decide o que anunciar no log. */
export interface ConfigureResult {
  docsEnabled: boolean;
  docsProtected: boolean;
}

/**
 * Aplica tudo o que a aplicação precisa antes de atender a primeira
 * requisição. Não chama `listen` — quem sobe decide como servir.
 */
export async function configureApp(
  app: NestFastifyApplication,
  env: AtlasEnv,
): Promise<ConfigureResult> {
  // Os casts existem porque `@fastify/cookie` faz declaration merging em
  // `FastifyInstance`, e o tipo esperado pelo `register` do Nest é o
  // FastifyInstance "puro" — os dois não se reconhecem. É atrito de
  // tipagem entre os pacotes, não incompatibilidade em tempo de execução.
  await app.register(helmet as never, {
    // O Swagger UI usa scripts e estilos inline.
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  });
  await app.register(cookie as never);

  app.enableCors({
    origin: buildCorsOrigin(env.CORS_ORIGINS, { allowPrivateNetwork: env.CORS_ALLOW_LAN }),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix(env.API_PREFIX);

  // Envelope padronizado de resposta e tradução de erros para o formato
  // `ApiErrorResponse` — o front-end tem um único caminho de tratamento.
  // O interceptor de métricas vem primeiro para medir o tempo TOTAL,
  // incluindo o que os demais interceptors gastam.
  app.useGlobalInterceptors(new HttpMetricsInterceptor(), new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  /**
   * Documentação.
   *
   * Fora de produção fica sempre disponível; em produção, SÓ com
   * credenciais configuradas — sem elas, desliga em vez de abrir.
   *
   * Havendo `DOCS_USER`/`DOCS_PASSWORD`, o Basic Auth vale nos dois
   * ambientes. Isso é o que permite consultar o `/docs` pelo túnel sem
   * publicar o mapa inteiro da API: em desenvolvimento a máquina está
   * exposta à internet do mesmo jeito que estaria em produção.
   */
  const docsCredentials =
    env.DOCS_USER && env.DOCS_PASSWORD
      ? { user: env.DOCS_USER, password: env.DOCS_PASSWORD }
      : null;

  const docsEnabled = env.NODE_ENV !== 'production' || docsCredentials !== null;

  if (docsEnabled) {
    if (docsCredentials) {
      // `as never` pelo mesmo motivo dos registros de helmet/cookie
      // acima: atrito de tipagem entre os pacotes, não incompatibilidade
      // em tempo de execução.
      app
        .getHttpAdapter()
        .getInstance()
        .addHook('onRequest', buildDocsGuard(docsCredentials) as never);
    }

    const config = new DocumentBuilder()
      .setTitle(`${APP_NAME} API`)
      .setDescription(
        'API do Atlas — treinos, evolução física, hidratação e sincronização offline-first.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  return { docsEnabled, docsProtected: docsCredentials !== null };
}
