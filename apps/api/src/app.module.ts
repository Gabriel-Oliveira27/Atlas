/**
 * Módulo raiz da API.
 *
 * Os guards de autenticação e RBAC são registrados GLOBALMENTE: o
 * padrão é rota protegida, e abrir uma rota exige `@Public()` explícito.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { EnvConfig } from './config/env.config.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { RbacGuard } from './modules/auth/guards/rbac.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ExercisesModule } from './modules/exercises/exercises.module.js';
import { WorkoutsModule } from './modules/workouts/workouts.module.js';
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
        // Nunca registrar credenciais no log.
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.refreshToken',
          'req.body.password',
        ],
      },
    }),

    ThrottlerModule.forRoot([
      {
        ttl: config.rateLimit.ttlSeconds * 1000,
        limit: config.rateLimit.max,
      },
    ]),

    ScheduleModule.forRoot(),

    PrismaModule,
    RedisModule,

    AuthModule,
    HealthModule,
    HomeModule,
    UsersModule,
    ExercisesModule,
    WorkoutsModule,
    HydrationModule,
    AssessmentsModule,
    SyncModule,
    AiModule,
    MediaModule,
  ],
  providers: [
    EnvConfig,
    // A ordem importa: rate limit → autenticação → autorização.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
export class AppModule {}
