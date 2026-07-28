import { Global, Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from './prisma.service.js';

/**
 * Módulo global de banco de dados.
 *
 * Global porque praticamente todo módulo de negócio precisa dele —
 * importar explicitamente em cada um seria ruído sem benefício.
 */
@Global()
@Module({
  providers: [EnvConfig, PrismaService],
  exports: [EnvConfig, PrismaService],
})
export class PrismaModule {}
