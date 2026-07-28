/**
 * Ponto de entrada da API do Atlas.
 *
 * NestJS sobre o adaptador Fastify: a estrutura do Nest (DI, módulos,
 * guards, interceptors) com o throughput do Fastify. Ver ADR-002.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import { parseEnv } from '@atlas/validation';
import { APP_NAME } from '@atlas/shared';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';

async function bootstrap(): Promise<void> {
  // Valida o ambiente ANTES de subir o Nest: falta de configuração deve
  // derrubar o processo imediatamente, com mensagem clara, e não quebrar
  // no meio de uma requisição em produção.
  const env = parseEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // O proxy à frente da API (Vercel/Nginx) define X-Forwarded-*;
      // sem isto, o rate limit veria o IP do proxy para todo mundo.
      trustProxy: true,
      bodyLimit: 10 * 1024 * 1024, // 10 MB (uploads passam pelo Cloudinary)
    }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

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
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix(env.API_PREFIX);

  // Envelope padronizado de resposta e tradução de erros para o formato
  // `ApiErrorResponse` — o front-end tem um único caminho de tratamento.
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
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

  await app.listen(env.API_PORT, env.API_HOST);

  const logger = app.get(Logger);
  logger.log(`Atlas API em http://localhost:${env.API_PORT}/${env.API_PREFIX}`);
  if (env.NODE_ENV !== 'production') {
    logger.log(`Documentação em http://localhost:${env.API_PORT}/docs`);
  }
}

void bootstrap();
