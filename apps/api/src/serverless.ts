/**
 * A API atendendo como função serverless (Vercel).
 *
 * Diferente do `main.ts`, aqui NADA escuta porta: a plataforma entrega a
 * requisição já aceita, e nós a empurramos para dentro do servidor HTTP
 * que o Fastify montou — `server.emit('request', ...)`. É o mesmo
 * caminho que o Fastify percorreria numa porta, só que sem o socket.
 *
 * ── O que NÃO funciona aqui, e é de propósito ───────────────────────
 * Uma função serverless não tem processo de longa duração: ela acorda,
 * responde e congela. Então, nesta instância:
 *
 *   • os cron da sincronização (03:00/18:00) e da poda NÃO rodam;
 *   • o verificador de saúde do DatabaseRouter, que roda de 15 em 15
 *     segundos, só corre durante uma invocação.
 *
 * Nada disso é defeito de implementação — é o que serverless é. Por isso
 * esta instância nasce com `SYNC_ENABLED=false` e
 * `SYNC_RETENTION_ENABLED=false` no ambiente: ela é uma boca de HTTP
 * sobre o Neon, e quem sincroniza e poda é o notebook, que tem os dois
 * bancos e um processo de verdade. Ligar os cron aqui não faria a
 * sincronização acontecer — faria cada requisição tentar registrar um
 * agendamento que morre junto com a invocação.
 *
 * ── Por que o app é cacheado num módulo ─────────────────────────────
 * Subir o Nest custa segundos. A plataforma reaproveita o mesmo processo
 * entre invocações próximas ("warm start"), então guardamos a PROMESSA
 * — não o app pronto. Guardar o app faria duas requisições simultâneas
 * num processo frio subirem o Nest duas vezes; guardando a promessa, a
 * segunda espera a primeira.
 */

import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { parseEnv } from '@atlas/validation';
import { AppModule } from './app.module.js';
import { configureApp, createFastifyAdapter } from './app-setup.js';

let aplicacao: Promise<NestFastifyApplication> | null = null;

async function montar(): Promise<NestFastifyApplication> {
  const env = parseEnv();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  await configureApp(app, env);

  // `init` em vez de `listen`: monta rotas, guards e interceptors sem
  // abrir socket. O `ready` do Fastify espera os plugins registrados —
  // sem ele, a primeira requisição pode chegar antes do helmet.
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}

/** Handler no formato que a Vercel invoca. */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  aplicacao ??= montar();
  const app = await aplicacao;

  app.getHttpAdapter().getInstance().server.emit('request', req, res);
}

/** Usado pelos testes locais do handler; a Vercel não chama isto. */
export async function prontidao(): Promise<NestFastifyApplication> {
  aplicacao ??= montar();
  return aplicacao;
}
