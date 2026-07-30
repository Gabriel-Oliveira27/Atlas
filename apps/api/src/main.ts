/**
 * Ponto de entrada da API do Atlas quando ela ESCUTA UMA PORTA —
 * notebook, Docker e Render.
 *
 * NestJS sobre o adaptador Fastify: a estrutura do Nest (DI, módulos,
 * guards, interceptors) com o throughput do Fastify. Ver ADR-002.
 *
 * A montagem da aplicação vive em `app-setup.ts`, compartilhada com o
 * entrypoint serverless da Vercel (`api/index.ts`). Aqui fica só o que é
 * exclusivo de um processo de longa duração: escutar a porta e anunciar
 * os endereços.
 */

import 'reflect-metadata';
import { networkInterfaces } from 'node:os';
import { NestFactory } from '@nestjs/core';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { parseEnv } from '@atlas/validation';
import { AppModule } from './app.module.js';
import { configureApp, createFastifyAdapter } from './app-setup.js';

async function bootstrap(): Promise<void> {
  // Valida o ambiente ANTES de subir o Nest: falta de configuração deve
  // derrubar o processo imediatamente, com mensagem clara, e não quebrar
  // no meio de uma requisição em produção.
  const env = parseEnv();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const { docsEnabled, docsProtected } = await configureApp(app, env);

  await app.listen(env.API_PORT, env.API_HOST);

  const logger = app.get(Logger);
  logger.log(`Atlas API em http://localhost:${env.API_PORT}/${env.API_PREFIX}`);

  if (docsEnabled) {
    const protecao = docsProtected ? 'protegida por usuário e senha' : 'ABERTA';
    logger.log(`Documentação em http://localhost:${env.API_PORT}/docs — ${protecao}`);
  }

  if (env.NODE_ENV !== 'production') {
    // Anuncia os endereços de rede local: é exatamente o valor que o
    // aplicativo precisa em EXPO_PUBLIC_API_URL, e descobri-lo por
    // `ipconfig` toda vez que o DHCP renova custa mais do que imprimir.
    for (const address of listLanAddresses()) {
      logger.log(`Alcançável na rede local em http://${address}:${env.API_PORT}/${env.API_PREFIX}`);
    }
  }
}

/** IPv4 das interfaces de rede, sem loopback nem interfaces virtuais. */
function listLanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

void bootstrap();
