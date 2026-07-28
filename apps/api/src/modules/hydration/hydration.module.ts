import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { HydrationController } from './hydration.controller.js';
import { HydrationService } from './hydration.service.js';

@Module({
  controllers: [HydrationController],
  providers: [EnvConfig, HydrationService],
  exports: [HydrationService],
})
export class HydrationModule {}
