import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [EnvConfig],
})
export class HealthModule {}
