import { Module } from '@nestjs/common';
import { EnvConfig } from '../../config/env.config.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

@Module({
  controllers: [AiController],
  providers: [EnvConfig, AiService],
  exports: [AiService],
})
export class AiModule {}
