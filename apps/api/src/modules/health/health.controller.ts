/**
 * Health check.
 *
 * `status` reflete a capacidade real de atender:
 *   ok       — banco principal e Redis respondendo
 *   degraded — funcionando, mas em contingência (Neon no lugar do local,
 *              ou Redis fora: filas e rate limit prejudicados)
 *   down     — nenhum banco disponível; a API não consegue responder
 */

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DependencyHealth, HealthCheckResponse } from '@atlas/shared';
import { Public } from '../../common/decorators/index.js';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';

const startedAt = Date.now();

@ApiTags('Sistema')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: EnvConfig,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Estado da API e de suas dependências' })
  async health(): Promise<HealthCheckResponse> {
    const now = new Date().toISOString();

    const [dbHealth, redisHealth] = await Promise.all([
      this.prisma.checkHealth(),
      this.redis.ping(),
    ]);

    const databaseLocal: DependencyHealth = {
      status: dbHealth.local.available ? 'up' : 'down',
      latencyMs: dbHealth.local.latencyMs,
      ...(dbHealth.local.error ? { error: dbHealth.local.error } : {}),
      checkedAt: dbHealth.local.checkedAt.toISOString(),
    };

    const databaseCloud: DependencyHealth = dbHealth.cloud
      ? {
          status: dbHealth.cloud.available ? 'up' : 'down',
          latencyMs: dbHealth.cloud.latencyMs,
          ...(dbHealth.cloud.error ? { error: dbHealth.cloud.error } : {}),
          checkedAt: dbHealth.cloud.checkedAt.toISOString(),
        }
      : // Neon não configurado é uma escolha, não uma falha.
        { status: 'disabled', checkedAt: now };

    const redis: DependencyHealth = {
      status: redisHealth.ok ? 'up' : 'down',
      latencyMs: redisHealth.latencyMs,
      ...(redisHealth.error ? { error: redisHealth.error } : {}),
      checkedAt: now,
    };

    const activeNode = dbHealth.activeNode;

    let status: HealthCheckResponse['status'] = 'ok';
    if (!activeNode) status = 'down';
    else if (this.prisma.isDegraded || !redisHealth.ok) status = 'degraded';

    return {
      status,
      version: '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      nodeId: this.config.nodeId,
      activeDatabase: activeNode,
      checks: { databaseLocal, databaseCloud, redis },
    };
  }

  /** Liveness: o processo está de pé? Usado por orquestradores. */
  @Public()
  @Get('health/live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dá para receber tráfego? Falso se nenhum banco responde. */
  @Public()
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe' })
  ready(): { ready: boolean; activeDatabase: string | null } {
    const activeNode = this.prisma.activeNode;
    return { ready: activeNode !== null, activeDatabase: activeNode };
  }
}
