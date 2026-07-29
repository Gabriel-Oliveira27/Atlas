/**
 * Limites de requisição por família de rota.
 *
 * Um limite único e global (o estado anterior: 120/min para tudo) trata
 * uma leitura de catálogo e uma tentativa de senha como se custassem o
 * mesmo — e custam coisas muito diferentes.
 *
 * ── Como o @nestjs/throttler funciona (e a armadilha) ───────────────
 * TODO throttler declarado no módulo é avaliado em TODA rota. Declarar
 * um throttler de IA com 5/hora e achar que ele só vale para `/ai/*` é
 * o caminho para a API inteira responder 429 depois de cinco
 * requisições — foi exatamente o que aconteceu aqui, e o que os testes
 * pegaram.
 *
 * A saída é o `skipIf` montado em `buildThrottlers`: cada família só
 * conta na rota que a declarou com `@ThrottleFamily(...)`, e o
 * throttler padrão se retira quando a rota declara uma família.
 *
 * Os valores vêm do ambiente validado (`EnvConfig`), não de
 * `process.env` cru: configuração inválida derruba o boot com mensagem
 * clara, em vez de virar um limite silenciosamente errado em produção.
 */

import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { THROTTLE_FAMILY_KEY } from '../common/decorators/index.js';
import type { EnvConfig } from './env.config.js';

export type ThrottleFamilyName = 'auth' | 'sync' | 'ai';

const reflector = new Reflector();

/** Família declarada na rota, se houver. */
function familyOf(context: ExecutionContext): ThrottleFamilyName | undefined {
  return reflector.getAllAndOverride<ThrottleFamilyName>(THROTTLE_FAMILY_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

/**
 * Lista de throttlers do módulo, já com o isolamento por família.
 *
 * O primeiro é o padrão (leituras em geral); os demais só entram na
 * rota que os declarou.
 */
export function buildThrottlers(config: EnvConfig): ThrottlerOptions[] {
  const { ttlSeconds, max, families } = config.rateLimit;

  const named = (Object.keys(families) as ThrottleFamilyName[]).map((name) => ({
    name,
    ...families[name],
    skipIf: (context: ExecutionContext) => familyOf(context) !== name,
  }));

  return [
    {
      ttl: ttlSeconds * 1000,
      limit: max,
      // Rota com família própria não é contada duas vezes.
      skipIf: (context: ExecutionContext) => familyOf(context) !== undefined,
    },
    ...named,
  ];
}
