/**
 * Módulo raiz da API.
 *
 * Os guards de autenticação e RBAC são registrados GLOBALMENTE: o
 * padrão é rota protegida, e abrir uma rota exige `@Public()` explícito.
 */

import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AtlasThrottlerGuard } from './common/guards/atlas-throttler.guard.js';
import { ScopeModule } from './common/scope/scope.module.js';
import { EnvConfig } from './config/env.config.js';
import { buildThrottlers } from './config/throttle.config.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { RedisThrottlerStorage } from './infra/redis/throttler-redis.storage.js';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { RbacGuard } from './modules/auth/guards/rbac.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ExercisesModule } from './modules/exercises/exercises.module.js';
import { WorkoutsModule } from './modules/workouts/workouts.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { HydrationModule } from './modules/hydration/hydration.module.js';
import { AssessmentsModule } from './modules/assessments/assessments.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { HomeModule } from './modules/home/home.module.js';

const config = new EnvConfig();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.all.LOG_LEVEL,
        // `pino-pretty` só em desenvolvimento: em produção o log
        // estruturado (JSON) é o que as ferramentas de observabilidade leem.
        ...(config.isProduction
          ? {}
          : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),

        /**
         * O id da requisição é definido pelo `genReqId` do Fastify (ver
         * `main.ts`), que o escreve de volta no header de entrada. Aqui
         * apenas o reaproveitamos, para que a linha de log, o envelope
         * da resposta e o header `x-request-id` carreguem o MESMO valor
         * — que é a única razão de o campo existir.
         */
        genReqId: (req) => {
          const incoming = req.headers['x-request-id'];
          return (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
        },

        // A latência por rota é medida pelo `HttpMetricsInterceptor`,
        // que enxerga a rota normalizada do Fastify — o logger recebe a
        // requisição crua, onde essa informação não existe.

        // Nunca registrar credenciais no log.
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.refreshToken',
          'req.body.password',
          'req.body.newPassword',
          'req.body.currentPassword',
        ],
      },
    }),

    // Rate limit com contador COMPARTILHADO no Redis (ver
    // `RedisThrottlerStorage`) e um throttler por família de rota (ver
    // `throttle.config.ts`). Sem `name`, o throttler é o padrão que vale
    // para toda rota que não declarar outro.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        storage,
        throttlers: buildThrottlers(config),
      }),
    }),

    ScheduleModule.forRoot(),

    PrismaModule,
    RedisModule,
    ScopeModule,

    AuthModule,
    HealthModule,
    HomeModule,
    UsersModule,
    ExercisesModule,
    WorkoutsModule,
    AdminModule,
    HydrationModule,
    AssessmentsModule,
    SyncModule,
    AiModule,
    MediaModule,
  ],
  providers: [
    EnvConfig,
    // A ordem importa: rate limit → autenticação → autorização.
    // O rate limit vem primeiro de propósito: se viesse depois, uma
    // enxurrada de tokens inválidos tomaria 401 sem nunca ser limitada.
    { provide: APP_GUARD, useClass: AtlasThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
export class AppModule {}
